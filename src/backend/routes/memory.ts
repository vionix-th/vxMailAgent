import express from 'express';
import { MemoryEntry } from '../../shared/types';
import logger from '../services/logger';
import { newId } from '../utils/id';
import { requireReq, getMemoryRepo, ReqLike } from '../utils/repo-access';
import { errorHandler, ValidationError, NotFoundError } from '../services/error-handler';
import { requireMemoryScope, optionalMemoryScope, requireMemoryOwner, requireContent, normalizeMemoryTags, normalizeOptionalString } from '../utils/memory-validation';

export interface MemoryRoutesDeps {}

export default function registerMemoryRoutes(app: express.Express, _deps: MemoryRoutesDeps) {
  // GET /api/memory
  app.get('/api/memory', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const params = req.query as Record<string, unknown>;
    const scope = optionalMemoryScope(params.scope, 'query.scope');
    const owner = normalizeOptionalString(params.owner, 'query.owner');
    const tag = normalizeOptionalString(params.tag, 'query.tag');
    const query = normalizeOptionalString(params.query ?? params.q, 'query.query');

    const ureq = requireReq(req as ReqLike);
    const repo = getMemoryRepo(ureq);
    let result = await repo.getAll();
    if (scope) result = result.filter((entry: MemoryEntry) => entry.scope === scope);
    if (owner) result = result.filter((entry: MemoryEntry) => entry.owner === owner);
    if (tag) result = result.filter((entry: MemoryEntry) => Array.isArray(entry.tags) && entry.tags.includes(tag));
    if (query) result = result.filter((entry: MemoryEntry) => entry.content.toLowerCase().includes(query.toLowerCase()));
    res.json(result);
  }));

  // POST /api/memory
  app.post('/api/memory', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const body = req.body as Partial<MemoryEntry> & Record<string, unknown>;
    const scope = requireMemoryScope(body.scope, 'body.scope');
    const owner = requireMemoryOwner(body.owner, 'body.owner');
    const content = requireContent(body.content, 'body.content');
    const now = new Date().toISOString();
    let id: string;
    if (typeof body.id === 'string' && body.id.trim()) {
      id = body.id.trim();
    } else if (typeof body.id === 'undefined' || body.id === null) {
      id = newId();
    } else {
      throw new ValidationError('body.id must be a non-empty string when provided', 'MEMORY_ID_INVALID');
    }
    let created = now;
    if (typeof body.created === 'string' && body.created.trim()) {
      created = body.created;
    } else if (typeof body.created !== 'undefined' && body.created !== null) {
      throw new ValidationError('body.created must be a non-empty string when provided', 'MEMORY_CREATED_INVALID');
    }
    const tags = normalizeMemoryTags(body.tags);
    const relatedEmailId = normalizeOptionalString(body.relatedEmailId, 'body.relatedEmailId');
    const entry: MemoryEntry = {
      id,
      scope,
      content,
      created,
      updated: now,
      owner,
      ...(tags ? { tags } : {}),
      ...(relatedEmailId ? { relatedEmailId } : {}),
      ...(typeof body.metadata !== 'undefined' ? { metadata: body.metadata } : {}),
    };
    const ureq = requireReq(req as ReqLike);
    const repo = getMemoryRepo(ureq);
    await repo.upsert(entry);
    logger.info('POST /api/memory: added', { id: entry.id });
    res.json({ success: true, entry });
  }));

  // PUT /api/memory/:id
  app.put('/api/memory/:id', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    if (!id || typeof id !== 'string') {
      throw new ValidationError('id param is required', 'MEMORY_ID_REQUIRED');
    }
    const patch = req.body as Partial<MemoryEntry> & Record<string, unknown>;
    const ureq = requireReq(req as ReqLike);
    const repo = getMemoryRepo(ureq);
    const now = new Date().toISOString();
    let updatedEntry: MemoryEntry | undefined;
    await repo.mutate(async (current) => {
      const idx = current.findIndex((entry) => entry.id === id);
      if (idx === -1) {
        throw new NotFoundError('Memory entry not found');
      }
      const next = current.slice();
      const entry = { ...next[idx] } as MemoryEntry;
      if (Object.prototype.hasOwnProperty.call(patch, 'content')) {
        entry.content = requireContent(patch.content, 'body.content');
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'scope')) {
        entry.scope = requireMemoryScope(patch.scope, 'body.scope');
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'owner')) {
        entry.owner = requireMemoryOwner(patch.owner, 'body.owner');
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'tags')) {
        const tags = normalizeMemoryTags(patch.tags);
        if (tags) {
          entry.tags = tags;
        } else {
          delete (entry as any).tags;
        }
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'relatedEmailId')) {
        const related = normalizeOptionalString(patch.relatedEmailId, 'body.relatedEmailId');
        if (related) {
          entry.relatedEmailId = related;
        } else {
          delete (entry as any).relatedEmailId;
        }
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'metadata')) {
        if (typeof patch.metadata === 'undefined') {
          delete (entry as any).metadata;
        } else {
          entry.metadata = patch.metadata as any;
        }
      }
      entry.updated = now;
      next[idx] = entry;
      updatedEntry = entry;
      return next;
    });
    logger.info('PUT /api/memory/:id updated', { id });
    res.json({ success: true, entry: updatedEntry });
  }));

  // DELETE /api/memory/:id
  app.delete('/api/memory/:id', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    const ureq = requireReq(req as ReqLike);
    const repo = getMemoryRepo(ureq);
    const deleted = await repo.deleteById(id);
    if (!deleted) {
      throw new NotFoundError('Memory entry not found');
    }
    logger.info('DELETE /api/memory/:id deleted', { id, deleted: 1 });
    res.json({ success: true });
  }));

  // DELETE /api/memory (batch)
  app.delete('/api/memory', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const ids = req.body?.ids as unknown;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((v) => typeof v === 'string' && v.trim())) {
      throw new ValidationError('ids must be a non-empty array of strings', 'MEMORY_IDS_INVALID');
    }
    const unique = new Set<string>(ids.map((v: string) => v.trim()));
    let removed = 0;
    const ureq = requireReq(req as ReqLike);
    const repo = getMemoryRepo(ureq);
    await repo.mutate((current) => {
      const next = current.filter((entry) => {
        if (unique.has(entry.id)) {
          removed++;
          return false;
        }
        return true;
      });
      return next;
    });
    logger.info('DELETE /api/memory batch deleted', { deleted: removed });
    res.json({ success: true, deleted: removed });
  }));
}
