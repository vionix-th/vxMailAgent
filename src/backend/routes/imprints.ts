import express from 'express';
import { Imprint } from '../../shared/types';
// Persistence handled by repository via deps.setImprints

export interface ImprintsRoutesDeps {
  getImprints: () => Imprint[];
  setImprints: (next: Imprint[]) => void;
}

export default function registerImprintsRoutes(app: express.Express, deps: ImprintsRoutesDeps) {
  app.get('/api/imprints', (_req, res) => {
    console.log(`[${new Date().toISOString()}] GET /api/imprints`);
    res.json(deps.getImprints());
  });

  app.post('/api/imprints', (req, res) => {
    const imprint: Imprint = req.body;
    const next = [...deps.getImprints(), imprint];
    deps.setImprints(next);
    console.log(`[${new Date().toISOString()}] POST /api/imprints: added imprint ${imprint.id}`);
    res.json({ success: true });
  });

  app.put('/api/imprints/:id', (req, res) => {
    const id = req.params.id;
    const current = deps.getImprints();
    const idx = current.findIndex(i => i.id === id);
    if (idx === -1) {
      console.warn(`[${new Date().toISOString()}] PUT /api/imprints/${id}: not found`);
      return res.status(404).json({ error: 'Imprint not found' });
    }
    const next = current.slice();
    next[idx] = req.body;
    deps.setImprints(next);
    console.log(`[${new Date().toISOString()}] PUT /api/imprints/${id}: updated`);
    res.json({ success: true });
  });

  app.delete('/api/imprints/:id', (req, res) => {
    const id = req.params.id;
    const current = deps.getImprints();
    const before = current.length;
    const next = current.filter(i => i.id !== id);
    deps.setImprints(next);
    const after = next.length;
    console.log(`[${new Date().toISOString()}] DELETE /api/imprints/${id}: ${before - after} deleted`);
    res.json({ success: true });
  });
}
