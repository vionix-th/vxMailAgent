// Tool call handlers for calendar, todo, filesystem, memory
// Switch to name-based dispatch; validation uses shared TOOL_REGISTRY schemas.
import { ToolCallResult } from '../shared/types';
import { validateAgainstSchema } from './validation';
import { TOOL_REGISTRY } from '../shared/tools';

export function createToolHandler(repos: {
  memory: Repository<MemoryEntry>;
  workspaceItems: Repository<WorkspaceItem>;
}) {
  async function handleToolByName(name: string, params: any): Promise<ToolCallResult> {
    const spec = TOOL_REGISTRY.find(t => t.name === name) || null;
    if (!spec) return { kind: name, success: false, result: null, error: 'Unknown tool name' };
    const errors: string[] = validateAgainstSchema(spec.parameters, params);
    const semErrors = validateToolSemantics(name as any, params);
    const allErrors = [...errors, ...semErrors];
    if (allErrors.length) {
      return { kind: name, success: false, result: { ok: false, errors: allErrors, received: sanitize(params) }, error: 'Invalid tool params' };
    }
    try {
      switch (name) {
        case 'calendar_read': {
          const r = await handleCalendarToolCall({ ...params, action: 'read' });
          return { ...r, kind: name };
        }
        case 'calendar_add': {
          const r = await handleCalendarToolCall({ ...params, action: 'add' });
          return { ...r, kind: name };
        }
        case 'todo_add': {
          const r = await handleTodoToolCall({ ...params, action: 'add' });
          return { ...r, kind: name };
        }
        case 'filesystem_search': {
          const r = await handleFilesystemToolCall({ ...params, action: 'search' });
          return { ...r, kind: name };
        }
        case 'filesystem_retrieve': {
          const r = await handleFilesystemToolCall({ ...params, action: 'retrieve' });
          return { ...r, kind: name };
        }
        case 'memory_search': {
          const r = await handleMemoryToolCall({ ...params, action: 'search' }, repos.memory);
          return { ...r, kind: name };
        }
        case 'memory_add': {
          const r = await handleMemoryToolCall({ ...params, action: 'add' }, repos.memory);
          return { ...r, kind: name };
        }
        case 'memory_edit': {
          const r = await handleMemoryToolCall({ ...params, action: 'edit' }, repos.memory);
          return { ...r, kind: name };
        }
        case 'workspace_add_item': {
          const r = await handleWorkspaceToolCall({ ...params, action: 'add' }, repos.workspaceItems);
          return { ...r, kind: name };
        }
        case 'workspace_list_items': {
          const r = await handleWorkspaceToolCall({ ...params, action: 'list' }, repos.workspaceItems);
          return { ...r, kind: name };
        }
        case 'workspace_get_item': {
          const r = await handleWorkspaceToolCall({ ...params, action: 'get' }, repos.workspaceItems);
          return { ...r, kind: name };
        }
        case 'workspace_update_item': {
          const r = await handleWorkspaceToolCall({ ...params, action: 'update' }, repos.workspaceItems);
          return { ...r, kind: name };
        }
        case 'workspace_remove_item': {
          const r = await handleWorkspaceToolCall({ ...params, action: 'remove' }, repos.workspaceItems);
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
  // Stub: log and return static result
  console.log('[TOOLCALL] calendar', payload);
  if (payload.action === 'read') {
    return { kind: 'calendar', success: true, result: [{ title: 'Stub Event', start: payload.dateRange?.start, end: payload.dateRange?.end }], error: undefined };
  } else if (payload.action === 'add') {
    return { kind: 'calendar', success: true, result: { added: true, event: payload.event }, error: undefined };
  }
  return { kind: 'calendar', success: false, result: null, error: 'Invalid calendar action' };
}

async function handleTodoToolCall(payload: any): Promise<ToolCallResult> {
  console.log('[TOOLCALL] todo', payload);
  if (payload.action === 'add') {
    return { kind: 'todo', success: true, result: { added: true, task: payload.task }, error: undefined };
  }
  return { kind: 'todo', success: false, result: null, error: 'Invalid todo action' };
}

async function handleFilesystemToolCall(payload: any): Promise<ToolCallResult> {
  console.log('[TOOLCALL] filesystem', payload);
  if (payload.action === 'search') {
    return { kind: 'filesystem', success: true, result: [{ file: 'stub.txt', path: '/virtual/stub.txt' }], error: undefined };
  } else if (payload.action === 'retrieve') {
    return { kind: 'filesystem', success: true, result: { file: payload.filePath, content: 'stub content' }, error: undefined };
  }
  return { kind: 'filesystem', success: false, result: null, error: 'Invalid filesystem action' };
}

import { MemoryEntry, MemoryScope, WorkspaceItem } from '../shared/types';

import { newId } from './utils/id';
import { Repository } from './repository/core';

export async function handleMemoryToolCall(payload: any, memoryRepo: Repository<MemoryEntry>): Promise<ToolCallResult> {
  console.log('[TOOLCALL] memory', payload);
  try {
    if (payload.action === 'search') {
      // Cascading fallback: local -> shared -> global
      const scopes = ['local', 'shared', 'global'];
      let found: MemoryEntry[] = [];

      const all = (memoryRepo.getAll() || []) as MemoryEntry[];
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
        return { kind: 'memory', success: true, result: [], error: undefined };
      }
      // Attach provenance to each result
      const resultWithProvenance = found.map(e => ({ ...e, provenance: { scope: e.scope, owner: typeof e.owner === 'string' ? e.owner : '' } }));
      return { kind: 'memory', success: true, result: resultWithProvenance, error: undefined };

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
      const entry: MemoryEntry | null = !errors.length && base ? {
        id: (base as any)?.id || newId(),
        scope: (base.scope as MemoryScope) || scope,
        content: String(base.content),
        created: now,
        updated: now,
        tags: base.tags,
        relatedEmailId: (base as any)?.relatedEmailId,
        owner: base.owner,
        metadata: base.metadata,
      } : null;
      if (!entry) {
        return { kind: 'memory', success: false, result: { ok: false, errors, received: sanitize(payload) }, error: 'Invalid memory add payload' };
      }
      const current = memoryRepo.getAll();
      const next = [...current, entry];
      memoryRepo.setAll(next);
      return { kind: 'memory', success: true, result: { added: true, entry }, error: undefined };
    } else if (payload.action === 'edit') {
      // Require an entry with id; merge provided fields
      const received = payload.entry;
      if (!received || typeof received !== 'object' || !received.id) {
        return { kind: 'memory', success: false, result: { ok: false, errors: ['Missing entry.id'], received: sanitize(payload) }, error: 'Invalid memory edit payload' };
      }
      const list = memoryRepo.getAll();
      const idx = list.findIndex((e: MemoryEntry) => e.id === received.id);
      if (idx === -1) {
        return { kind: 'memory', success: false, result: { ok: false, errors: ['Memory entry not found'], received: sanitize(payload) }, error: 'Memory entry not found' };
      }
      const updated = { ...list[idx], ...received, updated: new Date().toISOString() } as MemoryEntry;
      const next = list.slice();
      next[idx] = updated;
      memoryRepo.setAll(next);
      return { kind: 'memory', success: true, result: { edited: true, entry: updated }, error: undefined };
    }
    return { kind: 'memory', success: false, result: null, error: 'Invalid memory action' };
  } catch (err: any) {
    return { kind: 'memory', success: false, result: null, error: err?.message || String(err) };
  }
}

function validScope(s: any): s is MemoryScope {
  return s === 'global' || s === 'shared' || s === 'local';
}

async function handleWorkspaceToolCall(payload: any, workspaceRepo: Repository<WorkspaceItem>): Promise<ToolCallResult> {
  console.log('[TOOLCALL] workspace', payload);
  try {
    if (payload.action === 'add') {
      const now = new Date().toISOString();
      const item: WorkspaceItem = {
        id: newId(),
        label: payload.label || 'Untitled',
        description: payload.description,
        mimeType: payload.mimeType || 'text/plain',
        encoding: payload.encoding || 'utf8',
        data: payload.data || '',
        tags: payload.tags || [],
        created: now,
        updated: now,
        revision: 1,
        // Required context from orchestration
        context: payload.context,
      };
      const current = workspaceRepo.getAll();
      workspaceRepo.setAll([...current, item]);
      return { kind: 'workspace', success: true, result: { added: true, item }, error: undefined };
    } else if (payload.action === 'list') {
      const items = workspaceRepo.getAll();
      return { kind: 'workspace', success: true, result: items, error: undefined };
    } else if (payload.action === 'get') {
      const items = workspaceRepo.getAll();
      const item = items.find((i: WorkspaceItem) => i.id === payload.id);
      if (!item) {
        return { kind: 'workspace', success: false, result: null, error: 'Workspace item not found' };
      }
      return { kind: 'workspace', success: true, result: item, error: undefined };
    } else if (payload.action === 'update') {
      const items = workspaceRepo.getAll();
      const idx = items.findIndex((i: WorkspaceItem) => i.id === payload.id);
      if (idx === -1) {
        return { kind: 'workspace', success: false, result: null, error: 'Workspace item not found' };
      }
      const updated = { ...items[idx], ...payload.patch, updated: new Date().toISOString(), revision: (items[idx].revision || 0) + 1 };
      const next = items.slice();
      next[idx] = updated;
      workspaceRepo.setAll(next);
      return { kind: 'workspace', success: true, result: { updated: true, item: updated }, error: undefined };
    } else if (payload.action === 'remove') {
      const items = workspaceRepo.getAll();
      const filtered = items.filter((i: WorkspaceItem) => i.id !== payload.id);
      if (filtered.length === items.length) {
        return { kind: 'workspace', success: false, result: null, error: 'Workspace item not found' };
      }
      workspaceRepo.setAll(filtered);
      return { kind: 'workspace', success: true, result: { removed: true }, error: undefined };
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

function validateToolSemantics(kind: string, payload: any): string[] {
  const errs: string[] = [];
  if (kind === 'calendar') {
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
  } else if (kind === 'filesystem') {
    if (payload.action === 'search') {
      if (typeof payload.query !== 'string') errs.push('filesystem: search requires query string');
    } else if (payload.action === 'retrieve') {
      if (typeof payload.filePath !== 'string') errs.push('filesystem: retrieve requires filePath string');
    }
  } else if (kind === 'todo') {
    if (payload.action !== 'add') errs.push('todo: only action add is supported');
    else if (!payload.task || typeof payload.task.title !== 'string') errs.push('todo: add requires task.title string');
  } else if (kind === 'memory') {
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
