// Tool call handlers for calendar, todo, filesystem, memory
// Switch to name-based dispatch; validation uses shared TOOL_REGISTRY schemas.
import { ToolCallResult, MemoryEntry, ApiConfig, ConversationThread, Director, Agent, ToolDescriptor } from '../shared/types';
import { validateAgainstSchema, validateWorkspaceProvenance } from './validation';
import { TOOL_REGISTRY } from '../shared/tools';
import { TOOL_EXEC_TIMEOUT_MS } from './config';
import logger from './services/logger';
import { WorkspaceService } from './services/workspace-service';
import { newId } from './utils/id';
import type { RepoBundle } from './repository/registry';
import { ensureAgentThread, runAgentConversation } from './services/orchestration-agent';
import { ValidationError, InvalidAgentConfigError } from './services/error-handler';
import type { WorkspaceItemsRepoInstance } from './repository/wrappers';
import type { ConversationsRepoInstance } from './repository/wrappers';
import { serializeApiConfig } from './services/apiConfigSerializer';
import { resolveAgentToolDescriptors, resolveDirectorToolDescriptors, resolveMandatoryToolDescriptors } from './services/tool-config-service';
import { MemoryRepository } from './storage/sqlite/repositories/memory';
import { requireMemoryScope, optionalMemoryScope, requireMemoryOwner, requireContent, normalizeMemoryTags, normalizeOptionalString } from './utils/memory-validation';

interface ToolCallExecutionContext {
  workspace?: {
    conversationId: string;
  };
}

async function replaceConversations(
  repo: ConversationsRepoInstance,
  next: ConversationThread[]
): Promise<void> {
  const existing = await repo.list();
  const existingById = new Map(existing.map((thread) => [thread.id, thread] as const));
  const nextIds = new Set<string>();

  for (const thread of next) {
    nextIds.add(thread.id);
    if (existingById.has(thread.id)) {
      await repo.update(thread);
    } else {
      await repo.insert(thread);
    }
  }

  for (const thread of existing) {
    if (!nextIds.has(thread.id)) {
      await repo.delete(thread.id);
    }
  }
}

async function getDirectorWithDescriptors(
  repos: RepoBundle,
  directorId: string
): Promise<{ director: Director; descriptors: ToolDescriptor[] }> {
  const directors = await repos.directors.getAll();
  const director = (directors as Director[]).find((d) => d.id === directorId);
  if (!director) {
    throw new ValidationError('Director not found', 'DIRECTOR_NOT_FOUND');
  }
  return { director, descriptors: resolveDirectorToolDescriptors(director) };
}

async function getAgentWithDescriptors(
  repos: RepoBundle,
  agentId: string
): Promise<{ agent: Agent; descriptors: ToolDescriptor[] }> {
  const agents = await repos.agents.getAll();
  const agent = (agents as Agent[]).find((a) => a.id === agentId);
  if (!agent) {
    throw new InvalidAgentConfigError('Agent not found', 'AGENT_NOT_FOUND');
  }
  return { agent, descriptors: resolveAgentToolDescriptors(agent) };
}

export function createToolHandler(repos: RepoBundle) {
  async function handleToolByName(name: string, params: any, context?: ToolCallExecutionContext): Promise<ToolCallResult> {
    const spec = TOOL_REGISTRY.find(t => t.name === name) || null;
    if (!spec) return { kind: name, success: false, result: null, error: 'Unknown tool name' };
    const errors: string[] = validateAgainstSchema(spec.parameters, params);
    const semErrors = validateToolSemantics(name as any, params);
    const allErrors = [...errors, ...semErrors];
    if (allErrors.length) {
      return { kind: name, success: false, result: { ok: false, errors: allErrors, received: sanitize(params) }, error: 'Invalid tool params' };
    }
    try {
      const withTimeout = async <T>(p: Promise<T>): Promise<T> => {
        let to: any;
        try {
          const timed = await Promise.race([
            p,
            new Promise<never>((_, reject) => { to = setTimeout(() => reject(new Error(`tool_exec_timeout_${TOOL_EXEC_TIMEOUT_MS}ms`)), Math.max(1, TOOL_EXEC_TIMEOUT_MS || 0)); })
          ]);
          return timed as T;
        } finally {
          if (to) clearTimeout(to);
        }
      };
      switch (name) {
        // ---- Meta tools ----
        // consolidated 'list_agents' implementation lives below
        case 'list_tools': {
          // Prefer explicit entity id to infer allowlist; otherwise role-only with mandatory tools
          const roleRaw = typeof params?.role === 'string' ? params.role.toLowerCase() : '';
          const role = roleRaw === 'director' ? 'director' as const : 'agent' as const;
          const directorId = typeof params?.directorId === 'string' ? params.directorId : '';
          const agentId = typeof params?.agentId === 'string' ? params.agentId : '';
          let descs;
          if (directorId) {
            try {
              const { descriptors } = await getDirectorWithDescriptors(repos, directorId);
              descs = descriptors;
            } catch (error: any) {
              return { kind: name, success: false, result: null, error: error?.message || 'invalid_director_tool_config' };
            }
          } else if (agentId) {
            try {
              const { descriptors } = await getAgentWithDescriptors(repos, agentId);
              descs = descriptors;
            } catch (error: any) {
              return { kind: name, success: false, result: null, error: error?.message || 'invalid_agent_tool_config' };
            }
          } else {
            // No entity context: expose only mandatory after role gating
            descs = resolveMandatoryToolDescriptors(role);
          }
          const visible = descs.map(d => ({ name: d.name, description: d.description }));
          return { kind: name, success: true, result: visible };
        }
        case 'describe_tool': {
          const tname = typeof params?.name === 'string' ? params.name : '';
          if (!tname) return { kind: name, success: false, result: null, error: 'name is required' };
          const desc = TOOL_REGISTRY.find(t => t.name === tname);
          if (!desc) return { kind: name, success: false, result: null, error: 'tool not found' };
          return { kind: name, success: true, result: { name: desc.name, description: desc.description, parameters: desc.parameters } };
        }
        case 'read_api_docs': {
          const query = typeof params?.query === 'string' ? params.query : '';
          const topK = typeof params?.topK === 'number' ? params.topK : 3;
          if (!query) return { kind: name, success: false, result: null, error: 'query is required' };
          // Stub: return curated doc pointers; no filesystem access to avoid runtime path issues post-compile.
          const snippets = [
            { source: 'docs/DEVELOPER.md', note: 'Backend API and type system overview.' },
            { source: 'docs/DESIGN.md', note: 'Architecture, data model, and contracts.' },
            { source: 'README.md', note: 'Quick start and API summary.' },
          ].slice(0, Math.max(1, Math.min(3, topK)));
          return { kind: name, success: true, result: { query, matches: snippets } };
        }
        case 'delegate_to_agent': {
          const agentId = typeof params?.agentId === 'string' ? params.agentId : '';
          const input = typeof params?.input === 'string' ? params.input : '';
          const parentId = typeof params?.conversationId === 'string' ? params.conversationId : '';
          const directorId = typeof params?.directorId === 'string' ? params.directorId : '';
          if (!agentId || !input || !parentId || !directorId) {
            return { kind: name, success: false, result: null, error: 'Missing agentId, input, conversationId, or directorId' };
          }
          const conversations = [...await repos.conversations.list()];
          const parent = conversations.find((c: any) => c.id === parentId);
          if (!parent) return { kind: name, success: false, result: null, error: 'Parent conversation not found' };
          let dirObj: Director;
          try {
            ({ director: dirObj } = await getDirectorWithDescriptors(repos, directorId));
          } catch (error: any) {
            return { kind: name, success: false, result: null, error: error?.message || 'Director not found' };
          }
          let agentObj: Agent;
          let agentToolDescriptors: ToolDescriptor[];
          try {
            const agentResult = await getAgentWithDescriptors(repos, agentId);
            agentObj = agentResult.agent;
            agentToolDescriptors = agentResult.descriptors;
          } catch (error: any) {
            return { kind: name, success: false, result: null, error: error?.message || 'invalid_agent_tool_config' };
          }
          const prompts = await repos.prompts.getAll();
          const settingsArr = await repos.settings.getAll();
          const apiConfigs = (Array.isArray(settingsArr) && settingsArr.length > 0 && Array.isArray((settingsArr[0] as any)?.apiConfigs))
            ? (settingsArr[0] as any).apiConfigs as ApiConfig[]
            : null;
          if (!apiConfigs) {
            return { kind: name, success: false, result: null, error: 'settings_not_initialized' };
          }
          const nowIso = new Date().toISOString();
          let ensured: any;
          try {
            ensured = ensureAgentThread(
              conversations,
              parent.id,
              dirObj,
              agentObj,
              parent.email,
              prompts,
              apiConfigs,
              nowIso,
              newId,
              parent.accountId
            );
          } catch (e: any) {
            return { kind: name, success: false, result: null, error: e?.message || String(e) };
          }
          await replaceConversations(repos.conversations, ensured.conversations);

          const agentThread = ensured.agentThread;
          const apiCfg = apiConfigs.find((c: ApiConfig) => c.id === agentThread.apiConfigId);
          if (!apiCfg) return { kind: name, success: false, result: null, error: 'API config not found for agent' };
          const gatedToolDescriptors = agentToolDescriptors;
          const setConversations = async (next: ConversationThread[]) => {
            await replaceConversations(repos.conversations, next);
          };
          const rawHandleTool = createToolHandler(repos);
          const handleTool = (toolName: string, toolParams: any) =>
            rawHandleTool(
              toolName,
              toolParams,
              toolName.startsWith('workspace_') ? { workspace: { conversationId: agentThread.id } } : undefined,
            );
          const agentResult = await runAgentConversation(
            agentThread,
            input,
            ensured.conversations,
            serializeApiConfig(apiCfg),
            gatedToolDescriptors,
            setConversations as any,
            handleTool,
            undefined,
            { apiKey: apiCfg.apiKey },
          );
          if (agentResult.success) {
            return { kind: name, success: true, result: { content: agentResult.finalAssistantMessage?.content ?? null } };
          } else {
            return { kind: name, success: false, result: null, error: agentResult.error || 'Agent conversation failed' };
          }
        }
        case 'list_agents': {
          const allAgents = await repos.agents.getAll();
          const directorId = typeof params?.directorId === 'string' ? params.directorId : undefined;
          let result = allAgents;
          if (directorId) {
            const directors = await repos.directors.getAll();
            const dir = directors.find((d: any) => d.id === directorId);
            if (!dir) return { kind: name, success: false, result: null, error: 'Director not found' };
            const set = new Set<string>(Array.isArray(dir.agentIds) ? dir.agentIds : []);
            result = allAgents.filter((a: any) => set.has(a.id));
          }
          const agentsSlim = result.map((a: any) => ({ id: a.id, name: a.name, apiConfigId: a.apiConfigId }));
          return { kind: name, success: true, result: agentsSlim };
        }
        // duplicated meta-tool cases removed: canonical implementations are above
        case 'calendar_read': {
          const r = await withTimeout(handleCalendarToolCall({ ...params, action: 'read' }));
          return { ...r, kind: name };
        }
        case 'calendar_add': {
          const r = await withTimeout(handleCalendarToolCall({ ...params, action: 'add' }));
          return { ...r, kind: name };
        }
        case 'todo_add': {
          const r = await withTimeout(handleTodoToolCall({ ...params, action: 'add' }));
          return { ...r, kind: name };
        }
        case 'filesystem_search': {
          const r = await withTimeout(handleFilesystemToolCall({ ...params, action: 'search' }));
          return { ...r, kind: name };
        }
        case 'filesystem_retrieve': {
          const r = await withTimeout(handleFilesystemToolCall({ ...params, action: 'retrieve' }));
          return { ...r, kind: name };
        }
        case 'memory_search': {
          const r = await withTimeout(handleMemoryToolCall({ ...params, action: 'search' }, repos.memory));
          return { ...r, kind: name };
        }
        case 'memory_add': {
          const r = await withTimeout(handleMemoryToolCall({ ...params, action: 'add' }, repos.memory));
          return { ...r, kind: name };
        }
        case 'memory_edit': {
          const r = await withTimeout(handleMemoryToolCall({ ...params, action: 'edit' }, repos.memory));
          return { ...r, kind: name };
        }
        case 'workspace_add_item': {
          const r = await withTimeout(handleWorkspaceToolCall({ ...params, action: 'add' }, repos.workspaceItems, context?.workspace?.conversationId));
          return { ...r, kind: name };
        }
        case 'workspace_list_items': {
          const r = await withTimeout(handleWorkspaceToolCall({ ...params, action: 'list' }, repos.workspaceItems, context?.workspace?.conversationId));
          return { ...r, kind: name };
        }
        case 'workspace_get_item': {
          const r = await withTimeout(handleWorkspaceToolCall({ ...params, action: 'get' }, repos.workspaceItems, context?.workspace?.conversationId));
          return { ...r, kind: name };
        }
        case 'workspace_update_item': {
          const r = await withTimeout(handleWorkspaceToolCall({ ...params, action: 'update' }, repos.workspaceItems, context?.workspace?.conversationId));
          return { ...r, kind: name };
        }
        case 'workspace_remove_item': {
          const r = await withTimeout(handleWorkspaceToolCall({ ...params, action: 'remove' }, repos.workspaceItems, context?.workspace?.conversationId));
          return { ...r, kind: name };
        }
        default:
          return { kind: name, success: false, result: null, error: 'tool not implemented' };
      }
    } catch (e: any) {
      return { kind: name, success: false, result: null, error: e?.message || String(e) };
    }
  }
  return handleToolByName;
}

async function handleCalendarToolCall(payload: any): Promise<ToolCallResult> {
  // Fail closed: live calendar integration not implemented.
  logger.info('[TOOLCALL] calendar (not_implemented)', { payload });
  return { kind: 'calendar', success: false, result: null, error: 'not_implemented' };
}

async function handleTodoToolCall(payload: any): Promise<ToolCallResult> {
  // Fail closed: live todo integration not implemented.
  logger.info('[TOOLCALL] todo (not_implemented)', { payload });
  return { kind: 'todo', success: false, result: null, error: 'not_implemented' };
}

async function handleFilesystemToolCall(payload: any): Promise<ToolCallResult> {
  // Fail closed: virtual filesystem integration not implemented.
  logger.info('[TOOLCALL] filesystem (not_implemented)', { payload });
  return { kind: 'filesystem', success: false, result: null, error: 'not_implemented' };
}

 

export async function handleMemoryToolCall(payload: any, memoryRepo: MemoryRepository): Promise<ToolCallResult> {
  logger.info('[TOOLCALL] memory', { payload });
  try {
    const action = typeof payload?.action === 'string' ? payload.action : '';
    if (action === 'search') {
      const scope = optionalMemoryScope(payload.scope, 'memory_search.scope');
      const owner = normalizeOptionalString(payload.owner, 'memory_search.owner');
      const tag = normalizeOptionalString(payload.tag, 'memory_search.tag');
      const query = normalizeOptionalString(payload.query, 'memory_search.query');

      const list = await memoryRepo.list();
      const all = Array.isArray(list) ? list.slice() : Array.from(list);
      let filtered = scope ? all.filter((entry) => entry.scope === scope) : all;
      if (owner) filtered = filtered.filter((entry) => entry.owner === owner);
      if (tag) filtered = filtered.filter((entry) => Array.isArray(entry.tags) && entry.tags.includes(tag));
      if (query) filtered = filtered.filter((entry) => entry.content.toLowerCase().includes(query.toLowerCase()));

      const resultWithProvenance = filtered.map((entry) => {
        const provenance: Record<string, string> = { scope: entry.scope };
        if (entry.owner) {
          provenance.owner = entry.owner;
        }
        return { ...entry, provenance };
      });
      return { kind: 'memory', success: true, result: resultWithProvenance };
    }

    if (action === 'add') {
      const entryPayload = payload.entry && typeof payload.entry === 'object' ? payload.entry as Record<string, unknown> : undefined;
      const entryScope = entryPayload && Object.prototype.hasOwnProperty.call(entryPayload, 'scope')
        ? requireMemoryScope(entryPayload.scope, 'memory_add.entry.scope')
        : undefined;
      const requestScope = payload.scope !== undefined
        ? requireMemoryScope(payload.scope, 'memory_add.scope')
        : undefined;
      if (entryScope && requestScope && entryScope !== requestScope) {
        throw new ValidationError('memory_add.scope conflicts with entry.scope', 'MEMORY_SCOPE_CONFLICT');
      }
      const scope = entryScope ?? requestScope;
      if (!scope) {
        throw new ValidationError('scope is required', 'MEMORY_SCOPE_REQUIRED');
      }

      let owner: string | undefined;
      if (entryPayload && Object.prototype.hasOwnProperty.call(entryPayload, 'owner')) {
        owner = requireMemoryOwner(entryPayload.owner, 'memory_add.entry.owner');
      }
      if (!owner && payload.owner !== undefined) {
        owner = requireMemoryOwner(payload.owner, 'memory_add.owner');
      }
      if (!owner) {
        throw new ValidationError('owner is required', 'MEMORY_OWNER_REQUIRED');
      }

      let contentSource: unknown;
      if (entryPayload && Object.prototype.hasOwnProperty.call(entryPayload, 'content')) {
        contentSource = entryPayload.content;
      } else if (payload.content !== undefined) {
        contentSource = payload.content;
      } else if (payload.query !== undefined) {
        contentSource = payload.query;
      }
      const content = requireContent(contentSource, 'memory_add.content');

      const now = new Date().toISOString();
      let id = newId();
      if (entryPayload && Object.prototype.hasOwnProperty.call(entryPayload, 'id')) {
        const rawId = entryPayload.id;
        if (typeof rawId !== 'string' || !rawId.trim()) {
          throw new ValidationError('memory_add.entry.id must be a non-empty string', 'MEMORY_ID_INVALID');
        }
        id = rawId.trim();
      }

      let created = now;
      if (entryPayload && Object.prototype.hasOwnProperty.call(entryPayload, 'created')) {
        const rawCreated = entryPayload.created;
        if (typeof rawCreated !== 'string' || !rawCreated.trim()) {
          throw new ValidationError('memory_add.entry.created must be a non-empty string', 'MEMORY_CREATED_INVALID');
        }
        created = rawCreated;
      }

      const relatedEmailId = entryPayload && Object.prototype.hasOwnProperty.call(entryPayload, 'relatedEmailId')
        ? normalizeOptionalString(entryPayload.relatedEmailId, 'memory_add.entry.relatedEmailId')
        : normalizeOptionalString(payload.relatedEmailId, 'memory_add.relatedEmailId');

      const metadata = entryPayload && Object.prototype.hasOwnProperty.call(entryPayload, 'metadata')
        ? entryPayload.metadata
        : payload.metadata;

      const entryTags = entryPayload && Object.prototype.hasOwnProperty.call(entryPayload, 'tags')
        ? normalizeMemoryTags(entryPayload.tags)
        : undefined;
      const payloadTags = normalizeMemoryTags(payload.tags);
      const singleTag = normalizeOptionalString(payload.tag, 'memory_add.tag');
      const tags = mergeTags(entryTags, payloadTags, singleTag ? [singleTag] : undefined);

      const entry: MemoryEntry = {
        id,
        scope,
        content,
        created,
        updated: now,
        owner,
        ...(tags ? { tags } : {}),
        ...(relatedEmailId ? { relatedEmailId } : {}),
        ...(typeof metadata !== 'undefined' ? { metadata } : {}),
      };

      await memoryRepo.upsert(entry);
      return { kind: 'memory', success: true, result: { added: true, entry } };
    }

    if (action === 'edit') {
      const received = payload.entry;
      if (!received || typeof received !== 'object') {
        throw new ValidationError('memory_edit.entry is required', 'MEMORY_ENTRY_REQUIRED');
      }
      const entryObj = received as Record<string, unknown>;
      const rawId = entryObj.id;
      if (typeof rawId !== 'string' || !rawId.trim()) {
        throw new ValidationError('memory_edit.entry.id is required', 'MEMORY_ID_REQUIRED');
      }
      const entryId = rawId.trim();
      const now = new Date().toISOString();
      const current = await memoryRepo.findById(entryId);
      if (!current) {
        throw new ValidationError('Memory entry not found', 'MEMORY_ENTRY_NOT_FOUND');
      }
      const updatedEntry: MemoryEntry = { ...current };
      if (Object.prototype.hasOwnProperty.call(entryObj, 'content')) {
        updatedEntry.content = requireContent(entryObj.content, 'memory_edit.entry.content');
      }
      if (Object.prototype.hasOwnProperty.call(entryObj, 'scope')) {
        updatedEntry.scope = requireMemoryScope(entryObj.scope, 'memory_edit.entry.scope');
      }
      if (Object.prototype.hasOwnProperty.call(entryObj, 'owner')) {
        updatedEntry.owner = requireMemoryOwner(entryObj.owner, 'memory_edit.entry.owner');
      }
      if (Object.prototype.hasOwnProperty.call(entryObj, 'tags')) {
        const tags = normalizeMemoryTags(entryObj.tags);
        if (tags) {
          updatedEntry.tags = tags;
        } else {
          delete (updatedEntry as any).tags;
        }
      }
      if (Object.prototype.hasOwnProperty.call(entryObj, 'relatedEmailId')) {
        const related = normalizeOptionalString(entryObj.relatedEmailId, 'memory_edit.entry.relatedEmailId');
        if (related) {
          updatedEntry.relatedEmailId = related;
        } else {
          delete (updatedEntry as any).relatedEmailId;
        }
      }
      if (Object.prototype.hasOwnProperty.call(entryObj, 'metadata')) {
        if (typeof entryObj.metadata === 'undefined') {
          delete (updatedEntry as any).metadata;
        } else {
          updatedEntry.metadata = entryObj.metadata as any;
        }
      }
      updatedEntry.updated = now;
      await memoryRepo.update(updatedEntry);
      if (!updatedEntry) {
        throw new Error('Failed to update memory entry');
      }
      return { kind: 'memory', success: true, result: { edited: true, entry: updatedEntry } };
    }

    throw new ValidationError('Invalid memory action', 'MEMORY_ACTION_INVALID');
  } catch (err: any) {
    if (err instanceof ValidationError) {
      return { kind: 'memory', success: false, result: { ok: false, error: err.message, code: err.code, received: sanitize(payload) }, error: err.message };
    }
    return { kind: 'memory', success: false, result: null, error: err?.message || String(err) };
  }
}

function mergeTags(...sources: Array<string[] | undefined>): string[] | undefined {
  const merged: string[] = [];
  for (const source of sources) {
    if (!source) continue;
    for (const tag of source) {
      if (!merged.includes(tag)) {
        merged.push(tag);
      }
    }
  }
  return merged.length ? merged : undefined;
}

async function handleWorkspaceToolCall(payload: any, workspaceRepo: WorkspaceItemsRepoInstance, scopedConversationId?: string): Promise<ToolCallResult> {
  logger.info('[TOOLCALL] workspace', { payload });
  try {
    const conversationId = typeof scopedConversationId === 'string' && scopedConversationId.trim().length > 0
      ? scopedConversationId.trim()
      : (typeof payload?.conversationId === 'string' && payload.conversationId.trim().length > 0
        ? payload.conversationId.trim()
        : (typeof payload?.provenance?.conversationId === 'string' ? payload.provenance.conversationId.trim() : undefined));

    if (!conversationId) {
      throw new ValidationError('workspace tools require conversation scope');
    }

    const service = new WorkspaceService({
      repo: workspaceRepo,
      conversationId,
    });
    if (payload.action === 'add') {
      const prov = payload?.provenance || {};
      const provErrors = validateWorkspaceProvenance({ ...prov, conversationId });
      if (provErrors.length) {
        return { kind: 'workspace', success: false, result: { ok: false, errors: provErrors, received: sanitize(payload) }, error: 'Invalid workspace add payload' };
      }
      const mimeType = typeof payload.mimeType === 'string' ? payload.mimeType : undefined;
      if (!mimeType) {
        throw new ValidationError('workspace_add_item: mimeType is required');
      }
      const encoding = typeof payload.encoding === 'string' ? payload.encoding : undefined;
      if (!encoding) {
        throw new ValidationError('workspace_add_item: encoding is required');
      }
      const data = typeof payload.data === 'string' ? payload.data : undefined;
      if (typeof data === 'undefined') {
        throw new ValidationError('workspace_add_item: data is required');
      }
      const input = {
        content: {
          mimeType,
          encoding,
          data
        },
        metadata: {
          ...(typeof payload.label === 'string' ? { label: payload.label } : {}),
          ...(typeof payload.description === 'string' ? { description: payload.description } : {}),
          tags: Array.isArray(payload.tags) ? payload.tags : []
        },
        provenance: {
          emailId: prov.emailId,
          conversationId,
          createdBy: prov.createdBy,
          creatorId: prov.creatorId,
          ...(typeof prov.toolName === 'string' ? { toolName: prov.toolName } : { toolName: 'workspace_add_item' })
        }
      } as const;
      const item = await service.addItem(input as any);
      return { kind: 'workspace', success: true, result: { added: true, item } };
    } else if (payload.action === 'list') {
      const items = await service.listItems(false);
      return { kind: 'workspace', success: true, result: items };
    } else if (payload.action === 'get') {
      const item = await service.getItem(payload.id);
      if (!item) return { kind: 'workspace', success: false, result: null, error: 'Workspace item not found' };
      return { kind: 'workspace', success: true, result: item };
    } else if (payload.action === 'update') {
      const updated = await service.updateItem(payload.id, payload.patch, payload.expectedRevision);
      return { kind: 'workspace', success: true, result: { updated: true, item: updated } };
    } else if (payload.action === 'remove') {
      await service.hardDeleteItem(payload.id);
      return { kind: 'workspace', success: true, result: { removed: true } };
    }
    return { kind: 'workspace', success: false, result: null, error: 'Invalid workspace action' };
  } catch (err: any) {
    return { kind: 'workspace', success: false, result: null, error: err?.message || String(err) };
  }
}

function sanitize(obj: any) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return undefined;
  }
}

function baseKind(kind: string): string {
  // Normalize extended names like calendar_read -> calendar
  if (!kind) return '';
  if (kind.startsWith('calendar_')) return 'calendar';
  if (kind.startsWith('filesystem_')) return 'filesystem';
  if (kind.startsWith('todo_')) return 'todo';
  if (kind.startsWith('memory_')) return 'memory';
  if (kind.startsWith('workspace_')) return 'workspace';
  return kind;
}

function validateToolSemantics(kind: string, payload: any): string[] {
  const errs: string[] = [];
  const k = baseKind(kind);
  if (k === 'calendar') {
    if (payload.action === 'read') {
      if (!payload.dateRange || typeof payload.dateRange.start !== 'string' || typeof payload.dateRange.end !== 'string') {
        errs.push('calendar: read requires dateRange.start and dateRange.end strings');
      }
    } else if (payload.action === 'add') {
      const ev = payload.event || {};
      if (!ev || typeof ev.title !== 'string' || typeof ev.start !== 'string' || typeof ev.end !== 'string') {
        errs.push('calendar: add requires event.title, event.start, event.end strings');
      }
    }
  } else if (k === 'filesystem') {
    if (payload.action === 'search') {
      if (typeof payload.query !== 'string') errs.push('filesystem: search requires query string');
    } else if (payload.action === 'retrieve') {
      if (typeof payload.filePath !== 'string') errs.push('filesystem: retrieve requires filePath string');
    }
  } else if (k === 'todo') {
    if (payload.action !== 'add') errs.push('todo: only action add is supported');
    else if (!payload.task || typeof payload.task.title !== 'string') errs.push('todo: add requires task.title string');
  } else if (k === 'memory') {
    if (payload.action === 'edit') {
      if (!payload.entry || typeof payload.entry !== 'object' || typeof payload.entry.id !== 'string') {
        errs.push('memory: edit requires entry.id string');
      }
    } else if (payload.action === 'add') {
      if (!(payload.entry && typeof payload.entry === 'object') && !(typeof payload.content === 'string' || typeof payload.query === 'string')) {
        errs.push('memory: add requires entry object or content/query string');
      }
    }
  }
  return errs;
}
