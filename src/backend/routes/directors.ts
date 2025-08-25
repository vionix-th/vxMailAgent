import express from 'express';
import { Director } from '../../shared/types';
import { OPTIONAL_TOOL_NAMES } from '../../shared/tools';

export interface DirectorsRoutesDeps {
  getDirectors: () => Director[];
  setDirectors: (next: Director[]) => void;
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
  app.get('/api/directors', (_req, res) => {
    console.log(`[${new Date().toISOString()}] GET /api/directors`);
    const list = deps.getDirectors().map(d => ({ ...d, promptId: (d as any).promptId || '' }));
    res.json(list);
  });

  app.post('/api/directors', (req, res) => {
    const director: Director = req.body;
    if (!director.apiConfigId) {
      return res.status(400).json({ error: 'apiConfigId is required for Director' });
    }
    const clean: Director = { ...director, promptId: (director as any).promptId || '', enabledToolCalls: sanitizeEnabled((director as any).enabledToolCalls) } as Director;
    deps.setDirectors([...deps.getDirectors(), clean]);
    console.log(`[${new Date().toISOString()}] POST /api/directors: added director ${director.id}`);
    res.json({ success: true });
  });

  app.put('/api/directors/:id', (req, res) => {
    const id = req.params.id;
    const current = deps.getDirectors();
    const idx = current.findIndex(d => d.id === id);
    if (idx === -1) {
      console.warn(`[${new Date().toISOString()}] PUT /api/directors/${id}: not found`);
      return res.status(404).json({ error: 'Director not found' });
    }
    const updated = { ...req.body, promptId: req.body.promptId || '', enabledToolCalls: sanitizeEnabled((req.body as any).enabledToolCalls) } as Director;
    const next = current.slice();
    next[idx] = updated;
    deps.setDirectors(next);
    console.log(`[${new Date().toISOString()}] PUT /api/directors/${id}: updated`);
    res.json({ success: true });
  });

  app.delete('/api/directors/:id', (req, res) => {
    const id = req.params.id;
    const current = deps.getDirectors();
    const before = current.length;
    const next = current.filter(d => d.id !== id);
    deps.setDirectors(next);
    const after = next.length;
    console.log(`[${new Date().toISOString()}] DELETE /api/directors/${id}: ${before - after} deleted`);
    res.json({ success: true });
  });
}
