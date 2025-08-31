import express from 'express';
import { MemoryEntry } from '../../shared/types';
import { newId } from '../utils/id';
import { UserRequest, getUserContext } from '../middleware/user-context';
import logger from '../services/logger';

export interface MemoryRoutesDeps {}

export default function registerMemoryRoutes(app: express.Express, _deps: MemoryRoutesDeps) {
  // GET /api/memory
  app.get('/api/memory', (req, res) => {
    const { scope, query, owner, tag, q } = req.query as Record<string, string>;
    const { repos } = getUserContext(req as UserRequest);
    let result = repos.memory.getAll();
    if (scope) result = result.filter(e => e.scope === scope);
    if (owner) result = result.filter(e => e.owner === owner);
    if (tag) result = result.filter(e => e.tags && e.tags.includes(tag as string));
    const queryStr = query || q;
    if (queryStr) result = result.filter(e => e.content.toLowerCase().includes(queryStr.toLowerCase()));
    res.json(result);
  });

  // POST /api/memory
  app.post('/api/memory', (req, res) => {
    const entry = req.body as MemoryEntry;
    entry.id = entry.id || newId();
    entry.created = entry.created || new Date().toISOString();
    entry.updated = new Date().toISOString();
    const { repos } = getUserContext(req as UserRequest);
    const next = [...repos.memory.getAll(), entry];
    repos.memory.setAll(next);
    logger.info('POST /api/memory: added', { id: entry.id });
    res.json({ success: true, entry });
  });

  // PUT /api/memory/:id
  app.put('/api/memory/:id', (req, res) => {
    const id = req.params.id;
    const { repos } = getUserContext(req as UserRequest);
    const current = repos.memory.getAll();
    const idx = current.findIndex(e => e.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Memory entry not found' });
    const updated = { ...current[idx], ...req.body, id, updated: new Date().toISOString() } as MemoryEntry;
    const next = current.slice();
    next[idx] = updated;
    repos.memory.setAll(next);
    logger.info('PUT /api/memory/:id updated', { id });
    res.json({ success: true, entry: updated });
  });

  // DELETE /api/memory/:id
  app.delete('/api/memory/:id', (req, res) => {
    const id = req.params.id;
    const { repos } = getUserContext(req as UserRequest);
    const current = repos.memory.getAll();
    const before = current.length;
    const next = current.filter(e => e.id !== id);
    repos.memory.setAll(next);
    const after = next.length;
    logger.info('DELETE /api/memory/:id deleted', { id, deleted: before - after });
    res.json({ success: true });
  });

  // DELETE /api/memory (batch)
  app.delete('/api/memory', (req, res) => {
    const ids = (req.body?.ids || []) as string[];
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array required' });
    }
    const { repos } = getUserContext(req as UserRequest);
    const current = repos.memory.getAll();
    const before = current.length;
    const setIds = new Set(ids);
    const next = current.filter(e => !setIds.has(e.id));
    repos.memory.setAll(next);
    const after = next.length;
    logger.info('DELETE /api/memory batch deleted', { deleted: before - after });
    res.json({ success: true, deleted: before - after });
  });
}
