import express from 'express';
import { MemoryEntry } from '../../shared/types';
import { newId } from '../utils/id';

export interface MemoryRoutesDeps {
  getMemory: () => MemoryEntry[];
  setMemory: (next: MemoryEntry[]) => void;
}

export default function registerMemoryRoutes(app: express.Express, deps: MemoryRoutesDeps) {
  // GET /api/memory
  app.get('/api/memory', (req, res) => {
    const { scope, query, owner, tag, q } = req.query as Record<string, string>;
    let result = deps.getMemory();
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
    const next = [...deps.getMemory(), entry];
    deps.setMemory(next);
    console.log(`[${new Date().toISOString()}] POST /api/memory: added ${entry.id}`);
    res.json({ success: true, entry });
  });

  // PUT /api/memory/:id
  app.put('/api/memory/:id', (req, res) => {
    const id = req.params.id;
    const current = deps.getMemory();
    const idx = current.findIndex(e => e.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Memory entry not found' });
    const updated = { ...current[idx], ...req.body, id, updated: new Date().toISOString() } as MemoryEntry;
    const next = current.slice();
    next[idx] = updated;
    deps.setMemory(next);
    console.log(`[${new Date().toISOString()}] PUT /api/memory/${id}: updated`);
    res.json({ success: true, entry: updated });
  });

  // DELETE /api/memory/:id
  app.delete('/api/memory/:id', (req, res) => {
    const id = req.params.id;
    const current = deps.getMemory();
    const before = current.length;
    const next = current.filter(e => e.id !== id);
    deps.setMemory(next);
    const after = next.length;
    console.log(`[${new Date().toISOString()}] DELETE /api/memory/${id}: ${before - after} deleted`);
    res.json({ success: true });
  });

  // DELETE /api/memory (batch)
  app.delete('/api/memory', (req, res) => {
    const ids = (req.body?.ids || []) as string[];
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array required' });
    }
    const current = deps.getMemory();
    const before = current.length;
    const setIds = new Set(ids);
    const next = current.filter(e => !setIds.has(e.id));
    deps.setMemory(next);
    const after = next.length;
    console.log(`[${new Date().toISOString()}] DELETE /api/memory: ${before - after} deleted`);
    res.json({ success: true, deleted: before - after });
  });
}
