import express from 'express';
import { Imprint } from '../../shared/types';
import { ReqLike } from '../utils/repo-access';
// persistence is handled by injected deps.setImprints
import logger from '../services/logger';

export interface ImprintsRoutesDeps {
  getImprints: (req?: ReqLike) => Promise<Imprint[]>;
  setImprints: (req: ReqLike, next: Imprint[]) => Promise<void> | void;
}

export default function registerImprintsRoutes(app: express.Express, deps: ImprintsRoutesDeps) {
  app.get('/api/imprints', async (req, res) => {
    logger.info('GET /api/imprints');
    res.json(await deps.getImprints(req as ReqLike));
  });

  app.post('/api/imprints', async (req, res) => {
    const imprint: Imprint = req.body;
    const current = await deps.getImprints(req as ReqLike);
    const next = [...current, imprint];
    await deps.setImprints(req as ReqLike, next);
    logger.info('POST /api/imprints: added imprint', { id: imprint.id });
    res.json({ success: true });
  });

  app.put('/api/imprints/:id', async (req, res) => {
    const id = req.params.id;
    const current = await deps.getImprints(req as ReqLike);
    const idx = current.findIndex(i => i.id === id);
    if (idx === -1) {
      logger.warn('PUT /api/imprints/:id not found', { id });
      return res.status(404).json({ error: 'Imprint not found' });
    }
    const next = current.slice();
    next[idx] = req.body;
    await deps.setImprints(req as ReqLike, next);
    logger.info('PUT /api/imprints/:id updated', { id });
    res.json({ success: true });
  });

  app.delete('/api/imprints/:id', async (req, res) => {
    const id = req.params.id;
    const current = await deps.getImprints(req as ReqLike);
    const before = current.length;
    const next = current.filter(i => i.id !== id);
    await deps.setImprints(req as ReqLike, next);
    const after = next.length;
    logger.info('DELETE /api/imprints/:id deleted', { id, deleted: before - after });
    res.json({ success: true });
  });
}

