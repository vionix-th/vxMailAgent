import express from 'express';
import { MemoryEntry } from '../../shared/types';
import { newId } from '../utils/id';
import logger from '../services/logger';
import { requireReq, repoGetAll, repoSetAll, ReqLike } from '../utils/repo-access';
import { errorHandler, ValidationError, NotFoundError } from '../services/error-handler';

export interface MemoryRoutesDeps {}

export default function registerMemoryRoutes(app: express.Express, _deps: MemoryRoutesDeps) {
  // GET /api/memory
  app.get('/api/memory', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const { scope, query, owner, tag, q } = req.query as Record<string, string>;
    const ureq = requireReq(req as ReqLike);
    let result = await repoGetAll<MemoryEntry>(ureq, 'memory');
    if (scope) result = result.filter((e: MemoryEntry) => e.scope === scope);
    if (owner) result = result.filter((e: MemoryEntry) => e.owner === owner);
    if (tag) result = result.filter((e: MemoryEntry) => e.tags && e.tags.includes(tag as string));
    const queryStr = query || q;
    if (queryStr) result = result.filter((e: MemoryEntry) => e.content.toLowerCase().includes(queryStr.toLowerCase()));
    res.json(result);
  }));

  // POST /api/memory
  app.post('/api/memory', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const entry = req.body as MemoryEntry;
    if (!entry || typeof entry.content !== 'string' || !entry.content.trim()) {
      throw new ValidationError('Invalid memory entry');
    }
    entry.id = entry.id || newId();
    entry.created = entry.created || new Date().toISOString();
    entry.updated = new Date().toISOString();
    const ureq = requireReq(req as ReqLike);
    const cur = await repoGetAll<MemoryEntry>(ureq, 'memory');
    const next = [...cur, entry];
    await repoSetAll<MemoryEntry>(ureq, 'memory', next);
    logger.info('POST /api/memory: added', { id: entry.id });
    res.json({ success: true, entry });
  }));

  // PUT /api/memory/:id
  app.put('/api/memory/:id', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    const ureq = requireReq(req as ReqLike);
    const current = await repoGetAll<MemoryEntry>(ureq, 'memory');
    const idx = current.findIndex((e: MemoryEntry) => e.id === id);
    if (idx === -1) throw new NotFoundError('Memory entry not found');
    const updated = { ...current[idx], ...req.body, id, updated: new Date().toISOString() } as MemoryEntry;
    const next = current.slice();
    next[idx] = updated;
    await repoSetAll<MemoryEntry>(ureq, 'memory', next);
    logger.info('PUT /api/memory/:id updated', { id });
    res.json({ success: true, entry: updated });
  }));

  // DELETE /api/memory/:id
  app.delete('/api/memory/:id', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    const ureq = requireReq(req as ReqLike);
    const current = await repoGetAll<MemoryEntry>(ureq, 'memory');
    const before = current.length;
    const next = current.filter((e: MemoryEntry) => e.id !== id);
    await repoSetAll<MemoryEntry>(ureq, 'memory', next);
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
    const current = await repoGetAll<MemoryEntry>(ureq, 'memory');
    const before = current.length;
    const setIds = new Set(ids);
    const next = current.filter((e: MemoryEntry) => !setIds.has(e.id));
    await repoSetAll<MemoryEntry>(ureq, 'memory', next);
    const after = next.length;
    logger.info('DELETE /api/memory batch deleted', { deleted: before - after });
    res.json({ success: true, deleted: before - after });
  }));
}


