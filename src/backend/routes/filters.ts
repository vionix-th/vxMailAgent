import express from 'express';
import { Filter } from '../../shared/types';

export interface FiltersRoutesDeps {
  getFilters: () => Filter[];
  setFilters: (next: Filter[]) => void;
}

const allowedFields = ['from', 'to', 'cc', 'bcc', 'subject', 'body', 'date'] as const;

export default function registerFiltersRoutes(app: express.Express, deps: FiltersRoutesDeps) {
  app.get('/api/filters', (_req, res) => {
    console.log(`[${new Date().toISOString()}] GET /api/filters`);
    res.json(deps.getFilters());
  });

  app.post('/api/filters', (req, res) => {
    const filter: Filter = req.body;
    if (!allowedFields.includes(filter.field as any)) {
      console.warn(`[${new Date().toISOString()}] POST /api/filters: invalid field ${String(filter.field)}`);
      return res.status(400).json({ error: 'Invalid filter field', field: filter.field, allowedFields });
    }
    try {
      // eslint-disable-next-line no-new
      new RegExp(filter.regex, 'i');
    } catch (err) {
      console.warn(`[${new Date().toISOString()}] POST /api/filters: invalid regex ${String(filter.regex)} -> ${String(err)}`);
      return res.status(400).json({ error: 'Invalid regex', details: String(err) });
    }
    const next = [...deps.getFilters(), filter];
    deps.setFilters(next);
    console.log(`[${new Date().toISOString()}] POST /api/filters: added filter ${filter.id}`);
    res.json({ success: true });
  });

  app.put('/api/filters/reorder', (req, res) => {
    const body = req.body || {};
    const orderedIds: string[] = Array.isArray(body.orderedIds) ? body.orderedIds : [];
    if (!orderedIds.length) {
      return res.status(400).json({ error: 'orderedIds is required and must be a non-empty array' });
    }
    const current = deps.getFilters();
    const byId = new Map(current.map(f => [f.id, f] as const));
    const reordered: Filter[] = [];
    for (const id of orderedIds) {
      const f = byId.get(id);
      if (f) reordered.push(f);
    }
    for (const f of current) {
      if (!orderedIds.includes(f.id)) reordered.push(f);
    }
    deps.setFilters(reordered);
    console.log(`[${new Date().toISOString()}] PUT /api/filters/reorder: reordered ${reordered.length} filters`);
    res.json({ success: true });
  });

  app.put('/api/filters/:id', (req, res) => {
    const id = req.params.id;
    const current = deps.getFilters();
    const idx = current.findIndex(f => f.id === id);
    if (idx === -1) {
      console.warn(`[${new Date().toISOString()}] PUT /api/filters/${id}: not found`);
      return res.status(404).json({ error: 'Filter not found' });
    }
    const updated: Filter = req.body;
    if (!allowedFields.includes(updated.field as any)) {
      console.warn(`[${new Date().toISOString()}] PUT /api/filters/${id}: invalid field ${String(updated.field)}`);
      return res.status(400).json({ error: 'Invalid filter field', field: updated.field, allowedFields });
    }
    try {
      // eslint-disable-next-line no-new
      new RegExp(updated.regex, 'i');
    } catch (err) {
      console.warn(`[${new Date().toISOString()}] PUT /api/filters/${id}: invalid regex ${String(updated.regex)} -> ${String(err)}`);
      return res.status(400).json({ error: 'Invalid regex', details: String(err) });
    }
    const next = current.slice();
    next[idx] = updated;
    deps.setFilters(next);
    console.log(`[${new Date().toISOString()}] PUT /api/filters/${id}: updated`);
    res.json({ success: true });
  });

  app.delete('/api/filters/:id', (req, res) => {
    const id = req.params.id;
    const current = deps.getFilters();
    const before = current.length;
    const next = current.filter(f => f.id !== id);
    deps.setFilters(next);
    const after = next.length;
    console.log(`[${new Date().toISOString()}] DELETE /api/filters/${id}: ${before - after} deleted`);
    res.json({ success: true });
  });
}
