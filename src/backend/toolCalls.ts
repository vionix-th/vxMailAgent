// Tool call handlers for calendar, todo, filesystem, memory
// Switch to name-based dispatch; validation uses shared TOOL_REGISTRY schemas.
import { ToolCallResult, MemoryEntry, MemoryScope, ApiConfigPublic, ConversationThread } from '../shared/types';
import { validateAgainstSchema, validateWorkspaceProvenance } from './validation';
import { TOOL_REGISTRY } from '../shared/tools';
import { filterToolDescriptorsByRole, selectToolDescriptors } from './utils/tools';
import { TOOL_EXEC_TIMEOUT_MS } from './config';
import logger from './services/logger';
import { WorkspaceService } from './services/workspace-service';
import { Repository } from './repository/core';
import { newId } from './utils/id';
import type { RepoBundle } from './repository/registry';
import { ensureAgentThread, runAgentConversation } from './services/orchestration-agent';
import { ValidationError } from './services/error-handler';
import { WorkspaceItemsRepository } from './storage/sqlite/repositories/workspaceItems';

interface ToolCallExecutionContext {
  workspace?: {
    conversationId: string;
  };
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
            const directors = await repos.directors.getAll();
            const dir = (directors as any[]).find(d => d.id === directorId);
            descs = selectToolDescriptors('director', dir?.enabledToolCalls || []);
          } else if (agentId) {
            const agents = await repos.agents.getAll();
            const ag = (agents as any[]).find(a => a.id === agentId);
            descs = selectToolDescriptors('agent', ag?.enabledToolCalls || []);
          } else {
            // No entity context: expose only mandatory after role gating
            descs = selectToolDescriptors(role);
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
          const conversations = await repos.conversations.getAll();
          const parent = conversations.find((c: any) => c.id === parentId);
          if (!parent) return { kind: name, success: false, result: null, error: 'Parent conversation not found' };
          const directors = await repos.directors.getAll();
          const dirObj = directors.find((d: any) => d.id === directorId);
          if (!dirObj) return { kind: name, success: false, result: null, error: 'Director not found' };
          const agents = await repos.agents.getAll();
          const agentObj = agents.find((a: any) => a.id === agentId);
          if (!agentObj) return { kind: name, success: false, result: null, error: 'Agent not found' };
          const prompts = await repos.prompts.getAll();
          const settingsArr = await repos.settings.getAll();
          const apiConfigs = (Array.isArray(settingsArr) && settingsArr.length > 0 && Array.isArray((settingsArr[0] as any)?.apiConfigs))
            ? (settingsArr[0] as any).apiConfigs
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
          await repos.conversations.setAll(ensured.conversations);

          const agentThread = ensured.agentThread;
          const apiCfg = apiConfigs.find((c: any) => c.id === agentThread.apiConfigId);
          if (!apiCfg) return { kind: name, success: false, result: null, error: 'API config not found for agent' };
          const gatedToolDescriptors = filterToolDescriptorsByRole('agent');
          const setConversations = async (next: ConversationThread[]) => { await repos.conversations.setAll(next); };
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
            { id: apiCfg.id, name: apiCfg.name, model: apiCfg.model, ...(typeof apiCfg.maxCompletionTokens === 'number' ? { maxCompletionTokens: apiCfg.maxCompletionTokens } : {}) } as ApiConfigPublic,
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
          const r = await withTimeout(handleMemoryToolCall({ ...params, action: 'search' }, repos.memory as unknown as Repository<MemoryEntry>));
          return { ...r, kind: name };
        }
        case 'memory_add': {
          const r = await withTimeout(handleMemoryToolCall({ ...params, action: 'add' }, repos.memory as unknown as Repository<MemoryEntry>));
          return { ...r, kind: name };
        }
        case 'memory_edit': {
          const r = await withTimeout(handleMemoryToolCall({ ...params, action: 'edit' }, repos.memory as unknown as Repository<MemoryEntry>));
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

 

export async function handleMemoryToolCall(payload: any, memoryRepo: Repository<MemoryEntry>): Promise<ToolCallResult> {
  logger.info('[TOOLCALL] memory', { payload });
  try {
    if (payload.action === 'search') {
      // Cascading fallback: local -> shared -> global
      const scopes = ['local', 'shared', 'global'];
      let found: MemoryEntry[] = [];

      const all = await memoryRepo.getAll() as MemoryEntry[];
      for (const scope of (payload.scope ? [payload.scope, ...scopes.filter(s => s !== payload.scope)] : scopes)) {
        let filtered = all.filter((e: MemoryEntry) => e.scope === scope);
        if (payload.owner) filtered = filtered.filter((e: MemoryEntry) => e.owner === payload.owner);
        if (payload.tag) filtered = filtered.filter((e: MemoryEntry) => e.tags && e.tags.includes(payload.tag));
        if (payload.query) filtered = filtered.filter((e: MemoryEntry) => e.content.toLowerCase().includes(payload.query.toLowerCase()));
        if (filtered.length > 0) {
          found = filtered;

          break;
        }
      }
      // If nothing found, return empty
      if (found.length === 0) {
        return { kind: 'memory', success: true, result: [] };
      }
      // Attach provenance to each result without defaulting owner
      const resultWithProvenance = found.map(e => {
        const prov: any = { scope: e.scope };
        if (typeof e.owner === 'string') prov.owner = e.owner;
        return { ...e, provenance: prov };
      });
      return { kind: 'memory', success: true, result: resultWithProvenance };

    } else if (payload.action === 'add') {
      // Accept either an explicit entry object, or a shorthand with query/content
      const now = new Date().toISOString();
      const scope: MemoryScope = validScope(payload.scope) ? payload.scope : 'local';
      let base: Partial<MemoryEntry> | undefined = undefined;
      if (payload.entry && typeof payload.entry === 'object') {
        base = payload.entry as Partial<MemoryEntry>;
      } else if (typeof payload.content === 'string' || typeof payload.query === 'string') {
        base = {
          content: String(payload.content ?? payload.query),
          scope,
          tags: Array.isArray(payload.tags) ? payload.tags : (payload.tag ? [String(payload.tag)] : undefined),
          owner: typeof payload.owner === 'string' ? payload.owner : undefined,
        } as Partial<MemoryEntry>;
      }
      const errors: string[] = [];
      if (!base) errors.push('Missing entry or content/query');
      if (base && !base.content) errors.push('Missing content string');
      if (base && typeof base.owner !== 'string') errors.push('Missing owner');
      const entry: MemoryEntry | null = !errors.length && base ? {
        id: (base as any)?.id || newId(),
        scope: (base.scope as MemoryScope) || scope,
        content: String(base.content),
        created: now,
        updated: now,
        owner: base.owner as string,
        ...(Array.isArray(base.tags) ? { tags: base.tags } : {}),
        ...((base as any)?.relatedEmailId ? { relatedEmailId: (base as any).relatedEmailId } : {}),
        ...(base.metadata ? { metadata: base.metadata } : {}),
      } : null;
      if (!entry) {
        return { kind: 'memory', success: false, result: { ok: false, errors, received: sanitize(payload) }, error: 'Invalid memory add payload' };
      }
      const current = await memoryRepo.getAll();
      const next = [...current, entry];
      await memoryRepo.setAll(next);
      return { kind: 'memory', success: true, result: { added: true, entry } };
    } else if (payload.action === 'edit') {
      // Require an entry with id; merge provided fields
      const received = payload.entry;
      if (!received || typeof received !== 'object' || !received.id) {
        return { kind: 'memory', success: false, result: { ok: false, errors: ['Missing entry.id'], received: sanitize(payload) }, error: 'Invalid memory edit payload' };
      }
      const list = await memoryRepo.getAll();
      const idx = list.findIndex((e: MemoryEntry) => e.id === received.id);
      if (idx === -1) {
        return { kind: 'memory', success: false, result: { ok: false, errors: ['Memory entry not found'], received: sanitize(payload) }, error: 'Memory entry not found' };
      }
      const updated = { ...list[idx], ...received, updated: new Date().toISOString() } as MemoryEntry;
      const next = list.slice();
      next[idx] = updated;
      await memoryRepo.setAll(next);
      return { kind: 'memory', success: true, result: { edited: true, entry: updated } };
    }
    return { kind: 'memory', success: false, result: null, error: 'Invalid memory action' };
  } catch (err: any) {
    return { kind: 'memory', success: false, result: null, error: err?.message || String(err) };
  }
}

function validScope(s: any): s is MemoryScope {
  return s === 'global' || s === 'shared' || s === 'local';
}

async function handleWorkspaceToolCall(payload: any, workspaceRepo: WorkspaceItemsRepository, scopedConversationId?: string): Promise<ToolCallResult> {
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
      conversationId,
      getItems: () => workspaceRepo.getByConversation(conversationId),
      setItems: (next) => workspaceRepo.replaceForConversation(conversationId, next),
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
