import express from 'express';
import { Director } from '../../shared/types';
import { OPTIONAL_TOOL_NAMES } from '../../shared/tools';
import { ReqLike } from '../utils/repo-access';
// persistence is handled by injected deps.setDirectors
import logger from '../services/logger';

export interface DirectorsRoutesDeps {
  getDirectors: (req?: ReqLike) => Promise<Director[]>;
  setDirectors: (req: ReqLike, next: Director[]) => Promise<void> | void;
}

export default function registerDirectorsRoutes(app: express.Express, deps: DirectorsRoutesDeps) {
  const sanitizeEnabled = (v: any): string[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const out: string[] = [];
    for (const x of v) {
      if (typeof x !== 'string') continue;
      if ((OPTIONAL_TOOL_NAMES as readonly string[]).includes(x)) { out.push(x); continue; }
    }
    return out.length ? out : [];
  };
  // GET /api/directors
  app.get('/api/directors', async (req, res) => {
    logger.info('GET /api/directors');
    const list = (await deps.getDirectors(req as ReqLike)).map(d => ({ ...d, promptId: (d as any).promptId || '' }));
    res.json(list);
  });

  // POST /api/directors
  app.post('/api/directors', async (req, res) => {
    const director: Director = req.body;
    if (!director.apiConfigId) {
      return res.status(400).json({ error: 'apiConfigId is required for Director' });
    }
    const clean: Director = { ...director, promptId: (director as any).promptId || '', enabledToolCalls: sanitizeEnabled((director as any).enabledToolCalls) } as Director;
    const current = await deps.getDirectors(req as ReqLike);
    const next = [...current, clean];
    await deps.setDirectors(req as ReqLike, next);
    logger.info('POST /api/directors: added director', { id: director.id });
    res.json({ success: true });
  });

  // PUT /api/directors/:id
  app.put('/api/directors/:id', async (req, res) => {
    const id = req.params.id;
    const current = await deps.getDirectors(req as ReqLike);
    const idx = current.findIndex(d => d.id === id);
    if (idx === -1) {
      logger.warn('PUT /api/directors/:id not found', { id });
      return res.status(404).json({ error: 'Director not found' });
    }
    const clean: Director = { ...req.body, promptId: req.body.promptId || '', enabledToolCalls: sanitizeEnabled((req.body as any).enabledToolCalls) } as Director;
    const next = current.slice();
    next[idx] = clean;
    await deps.setDirectors(req as ReqLike, next);
    logger.info('PUT /api/directors/:id updated', { id });
    res.json({ success: true });
  });

  // DELETE /api/directors/:id
  app.delete('/api/directors/:id', async (req, res) => {
    const id = req.params.id;
    const current = await deps.getDirectors(req as ReqLike);
    const before = current.length;
    const next = current.filter(d => d.id !== id);
    await deps.setDirectors(req as ReqLike, next);
    const after = next.length;
    logger.info('DELETE /api/directors/:id deleted', { id, deleted: before - after });
    res.json({ success: true });
  });
}

