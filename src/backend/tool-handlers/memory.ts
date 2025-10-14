import { ToolCallResult, MemoryEntry } from '../../shared/types';
import { ToolHandlerRegistrar, ToolExecutionRuntime } from './types';
import logger from '../services/logger';
import { MemoryRepository } from '../storage/sqlite/repositories/memory';
import { ValidationError } from '../services/error-handler';
import { requireMemoryScope, optionalMemoryScope, requireMemoryOwner, requireContent, normalizeMemoryTags, normalizeOptionalString } from '../utils/memory-validation';

export function registerMemoryHandlers(register: ToolHandlerRegistrar) {
  register('memory_search', (runtime) => executeMemory('memory_search', runtime, 'search'));
  register('memory_add', (runtime) => executeMemory('memory_add', runtime, 'add'));
  register('memory_edit', (runtime) => executeMemory('memory_edit', runtime, 'edit'));
}

async function executeMemory(toolName: string, runtime: ToolExecutionRuntime, action: 'search' | 'add' | 'edit'): Promise<ToolCallResult> {
  const result = await runtime.withTimeout(handleMemoryToolCall({ ...runtime.params, action }, runtime.repos.memory));
  return { ...result, kind: toolName };
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
      }
      const content = requireContent(contentSource, 'memory_add.content');

      const tags = mergeTags(
        Array.isArray(payload.tags) ? payload.tags : undefined,
        entryPayload && Array.isArray(entryPayload.tags) ? entryPayload.tags : undefined
      );

      const entry: MemoryEntry = {
        id: typeof entryPayload?.id === 'string' ? entryPayload.id : payload.id || `mem_${Date.now()}`,
        scope,
        owner,
        content,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        tags: tags ?? [],
      };
      await memoryRepo.insert(entry);
      return { kind: 'memory', success: true, result: entry };
    }

    if (action === 'edit') {
      const entry = await memoryRepo.findById(payload.id);
      if (!entry) {
        return { kind: 'memory', success: false, result: null, error: 'memory entry not found' };
      }
      const patch = payload.entry && typeof payload.entry === 'object' ? payload.entry as Record<string, unknown> : {};
      const next: MemoryEntry = {
        ...entry,
        ...(Object.prototype.hasOwnProperty.call(patch, 'content') ? { content: requireContent(patch.content, 'memory_edit.entry.content') } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, 'owner') ? { owner: requireMemoryOwner(patch.owner, 'memory_edit.entry.owner') } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, 'scope') ? { scope: requireMemoryScope(patch.scope, 'memory_edit.entry.scope') } : {}),
        tags: normalizeMemoryTags(Array.isArray(patch.tags) ? patch.tags : payload.tags),
        updated: new Date().toISOString(),
      };
      await memoryRepo.update(next);
      return { kind: 'memory', success: true, result: next };
    }

    return { kind: 'memory', success: false, result: null, error: 'Unsupported memory action' };
  } catch (err: any) {
    if (err instanceof ValidationError) {
      logger.warn('Memory tool validation failed', {
        error: err.message,
        code: err.code,
        payload: sanitize(payload),
      });
      return { kind: 'memory', success: false, result: { ok: false, error: err.message, code: err.code, received: sanitize(payload) }, error: err.message };
    }
    const message = err?.message || String(err);
    logger.error('Memory tool execution failed', {
      error: message,
      payload: sanitize(payload),
    });
    return { kind: 'memory', success: false, result: null, error: message };
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

function sanitize(obj: any) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return undefined;
  }
}
