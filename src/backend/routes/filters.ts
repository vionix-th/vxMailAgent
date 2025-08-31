import express from 'express';
import { Filter } from '../../shared/types';
import { UserRequest } from '../middleware/user-context';
import logger from '../services/logger';
// persistence is handled by injected deps.setFilters

export interface FiltersRoutesDeps {
  getFilters: (req?: UserRequest) => Filter[];
  setFilters: (req: UserRequest, next: Filter[]) => void;
}

const allowedFields = ['from', 'to', 'cc', 'bcc', 'subject', 'body', 'date'] as const;

export default function registerFiltersRoutes(app: express.Express, deps: FiltersRoutesDeps) {
  // GET /api/filters
  app.get('/api/filters', (req, res) => {
    logger.info('GET /api/filters');
    res.json(deps.getFilters(req as UserRequest));
  });

  // POST /api/filters
  app.post('/api/filters', (req, res) => {
    const filter: Filter = req.body;
    if (!allowedFields.includes(filter.field as any)) {
      logger.warn('POST /api/filters: invalid field', { field: String(filter.field), allowedFields });
      return res.status(400).json({ error: 'Invalid filter field', field: filter.field, allowedFields });
    }
    try {
      // eslint-disable-next-line no-new
      new RegExp(filter.regex, 'i');
    } catch (err) {
      logger.warn('POST /api/filters: invalid regex', { regex: String(filter.regex), err: String(err) });
      return res.status(400).json({ error: 'Invalid regex', details: String(err) });
    }
    const next = [...deps.getFilters(req as UserRequest), filter];
    deps.setFilters(req as UserRequest, next);
    logger.info('POST /api/filters: added filter', { id: filter.id });
    res.json({ success: true });
  });

  // PUT /api/filters/reorder
  app.put('/api/filters/reorder', (req, res) => {
    const body = req.body || {};
    const orderedIds: string[] = Array.isArray(body.orderedIds) ? body.orderedIds : [];
    if (!orderedIds.length) {
      return res.status(400).json({ error: 'orderedIds is required and must be a non-empty array' });
    }
    const current = deps.getFilters(req as UserRequest);
    const byId = new Map(current.map(f => [f.id, f] as const));
    const reordered: Filter[] = [];
    for (const id of orderedIds) {
      const f = byId.get(id);
      if (f) reordered.push(f);
    }
    for (const f of current) {
      if (!orderedIds.includes(f.id)) reordered.push(f);
    }
    deps.setFilters(req as UserRequest, reordered);
    logger.info('PUT /api/filters/reorder: reordered filters', { count: reordered.length });
    res.json({ success: true });
  });

  // PUT /api/filters/:id
  app.put('/api/filters/:id', (req, res) => {
    const id = req.params.id;
    const current = deps.getFilters(req as UserRequest);
    const idx = current.findIndex(f => f.id === id);
    if (idx === -1) {
      logger.warn('PUT /api/filters/:id not found', { id });
      return res.status(404).json({ error: 'Filter not found' });
    }
    const updated: Filter = req.body;
    if (!allowedFields.includes(updated.field as any)) {
      logger.warn('PUT /api/filters/:id invalid field', { id, field: String(updated.field), allowedFields });
      return res.status(400).json({ error: 'Invalid filter field', field: updated.field, allowedFields });
    }
    try {
      // eslint-disable-next-line no-new
      new RegExp(updated.regex, 'i');
    } catch (err) {
      logger.warn('PUT /api/filters/:id invalid regex', { id, regex: String(updated.regex), err: String(err) });
      return res.status(400).json({ error: 'Invalid regex', details: String(err) });
    }
    const next = current.slice();
    next[idx] = updated;
    deps.setFilters(req as UserRequest, next);
    logger.info('PUT /api/filters/:id updated', { id });
    res.json({ success: true });
  });

  // DELETE /api/filters/:id
  app.delete('/api/filters/:id', (req, res) => {
    const id = req.params.id;
    const current = deps.getFilters(req as UserRequest);
    const before = current.length;
    const next = current.filter(f => f.id !== id);
    deps.setFilters(req as UserRequest, next);
    const after = next.length;
    logger.info('DELETE /api/filters/:id deleted', { id, deleted: before - after });
    res.json({ success: true });
  });
}
