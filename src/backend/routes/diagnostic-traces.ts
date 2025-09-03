import express from 'express';
import type { Trace } from '../../shared/types';
import { ReqLike } from '../utils/repo-access';


export default function registerDiagnosticTracesRoutes(
  app: express.Express, 
  services: {
    getTraces: (req?: ReqLike) => Promise<Trace[]>;
    setTraces: (req: ReqLike, next: Trace[]) => Promise<void>;
  }
) {
  const router = express.Router();

  // List traces in canonical order with optional pagination only (no filters, no sorting)
  router.get('/diagnostics/traces', async (req, res) => {
    const { limit, offset } = req.query as Record<string, string>;
    const lim = Math.min(Math.max(parseInt(String(limit || '100'), 10) || 100, 1), 1000);
    const off = Math.max(parseInt(String(offset || '0'), 10) || 0, 0);

    const traces = await services.getTraces(req as any as ReqLike); // canonical insertion order
    const total = traces.length;
    const slice = traces.slice(off, off + lim);

    // Summarize to a canonical correlated shape expected by the UI
    const items = slice.map(t => {
      const spanCount = t.spans?.length || 0;
      // Best-effort correlation: take first seen ids from spans
      const firstDir = t.spans?.find(s => !!s.directorId)?.directorId;
      const firstAg = t.spans?.find(s => !!s.agentId)?.agentId;
      return {
        id: t.id,
        createdAt: t.createdAt,
        status: t.status,
        emailId: (t as any).emailId,
        directorId: firstDir,
        agentId: firstAg,
        spanCount,
      };
    });

    res.json({ total, items });
  });

  // Get a single trace by id
  router.get('/diagnostics/trace/:id', async (req, res) => {
    const id = req.params.id;
    const t = (await services.getTraces(req as any as ReqLike)).find(x => x.id === id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    res.json(t);
  });

  // Delete a single trace by id
  router.delete('/diagnostics/trace/:id', async (req, res) => {
    const id = req.params.id;
    const before = await services.getTraces(req as any as ReqLike);
    const next = before.filter(t => t.id !== id);
    const deleted = before.length - next.length;
    if (deleted > 0) await services.setTraces(req as any as ReqLike, next);
    res.json({ deleted });
  });

  // Bulk delete traces by ids, or clear all if no ids provided
  router.delete('/diagnostics/traces', async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : [];
    const before = await services.getTraces(req as any as ReqLike);
    let next: Trace[] = before;
    if (ids.length > 0) {
      const set = new Set(ids);
      next = before.filter(t => !set.has(t.id));
    } else {
      next = [];
    }
    const deleted = before.length - next.length;
    await services.setTraces(req as any as ReqLike, next);
    res.json({ deleted });
  });

  app.use('/api', router);
}
