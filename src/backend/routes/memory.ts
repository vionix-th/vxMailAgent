import express from 'express';
import { MemoryEntry } from '../../shared/types';
import logger from '../services/logger';
import { newId } from '../utils/id';
import { requireReq, getMemoryRepo, ReqLike } from '../utils/repo-access';
import { errorHandler, ValidationError, NotFoundError } from '../services/error-handler';

export interface MemoryRoutesDeps {}

export default function registerMemoryRoutes(app: express.Express, _deps: MemoryRoutesDeps) {
  // GET /api/memory
  app.get('/api/memory', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const { scope, query, owner, tag, q } = req.query as Record<string, string>;
    const ureq = requireReq(req as ReqLike);
    const repo = getMemoryRepo(ureq);
    let result = await repo.getAll();
    if (scope) result = result.filter((e: MemoryEntry) => e.scope === scope);
    if (owner) result = result.filter((e: MemoryEntry) => e.owner === owner);
    if (tag) result = result.filter((e: MemoryEntry) => e.tags && e.tags.includes(tag as string));
    const queryStr = query || q;
    if (queryStr) result = result.filter((e: MemoryEntry) => e.content.toLowerCase().includes(queryStr.toLowerCase()));
    res.json(result);
  }));

  // POST /api/memory
  app.post('/api/memory', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const body = req.body as Partial<MemoryEntry>;
    if (!body || typeof body.content !== 'string' || !body.content.trim()) {
      throw new ValidationError('Invalid memory entry');
    }
    const now = new Date().toISOString();
    if (body.scope !== 'global' && body.scope !== 'shared' && body.scope !== 'local') {
      throw new ValidationError('scope required (global|shared|local)');
    }
    if (typeof body.owner !== 'string' || !body.owner) {
      throw new ValidationError('owner required');
    }
    const entry: MemoryEntry = {
      id: typeof body.id === 'string' && body.id ? body.id : newId(),
      scope: body.scope,
      content: body.content,
      created: typeof body.created === 'string' && body.created ? body.created : now,
      updated: now,
      ...(Array.isArray(body.tags) ? { tags: body.tags } : {}),
      ...(typeof body.relatedEmailId === 'string' ? { relatedEmailId: body.relatedEmailId } : {}),
      owner: body.owner,
      ...(body.metadata ? { metadata: body.metadata } : {}),
    };
    const ureq = requireReq(req as ReqLike);
    const repo = getMemoryRepo(ureq);
    const cur = await repo.getAll();
    const next = [...cur, entry];
    await repo.setAll(next);
    logger.info('POST /api/memory: added', { id: entry.id });
    res.json({ success: true, entry });
  }));

  // PUT /api/memory/:id
  app.put('/api/memory/:id', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    const ureq = requireReq(req as ReqLike);
    const repo = getMemoryRepo(ureq);
    const current = await repo.getAll();
    const idx = current.findIndex((e: MemoryEntry) => e.id === id);
    if (idx === -1) throw new NotFoundError('Memory entry not found');
    const updated = { ...current[idx], ...req.body, id, updated: new Date().toISOString() } as MemoryEntry;
    const next = current.slice();
    next[idx] = updated;
    await repo.setAll(next);
    logger.info('PUT /api/memory/:id updated', { id });
    res.json({ success: true, entry: updated });
  }));

  // DELETE /api/memory/:id
  app.delete('/api/memory/:id', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    const ureq = requireReq(req as ReqLike);
    const repo = getMemoryRepo(ureq);
    const current = await repo.getAll();
    const before = current.length;
    const next = current.filter((e: MemoryEntry) => e.id !== id);
    await repo.setAll(next);
    const after = next.length;
    logger.info('DELETE /api/memory/:id deleted', { id, deleted: before - after });
    res.json({ success: true });
  }));

  // DELETE /api/memory (batch)
  app.delete('/api/memory', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const ids = req.body?.ids as string[];
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new ValidationError('ids array required');
    }
    const ureq = requireReq(req as ReqLike);
    const repo = getMemoryRepo(ureq);
    const current = await repo.getAll();
    const before = current.length;
    const setIds = new Set(ids);
    const next = current.filter((e: MemoryEntry) => !setIds.has(e.id));
    await repo.setAll(next);
    const after = next.length;
    logger.info('DELETE /api/memory batch deleted', { deleted: before - after });
    res.json({ success: true, deleted: before - after });
  }));
}
