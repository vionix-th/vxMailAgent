import express from 'express';
import { OrchestrationDiagnosticEntry } from '../../shared/types';
import logger from '../services/logger';
import { ReqLike } from '../utils/repo-access';

import { LiveRepos } from '../liveRepos';

export default function registerOrchestrationRoutes(
  app: express.Express, 
  repos: LiveRepos,
  services: {
    setOrchestrationLog: (next: OrchestrationDiagnosticEntry[], req?: ReqLike) => Promise<void>;
  }
) {
  // GET diagnostics: via repository with filters and pagination
  // /api/orchestration/diagnostics?director=&agent=&emailId=&phase=&since=&until=&limit=&offset=
  app.get('/api/orchestration/diagnostics', async (req, res) => {
    try {
      let log: OrchestrationDiagnosticEntry[] = [];
      try { log = await repos.getOrchestrationLog(req as any as ReqLike); } catch (e) { logger.error('getOrchestrationLog failed', { err: e }); }
      const q = req.query as Record<string, string>;
      const director = q.director?.trim();
      const agent = q.agent?.trim();
      const emailId = q.emailId?.trim();
      const phase = q.phase?.trim() as any;
      const sinceMs = q.since ? Date.parse(q.since) : 0;
      const untilMs = q.until ? Date.parse(q.until) : 0;
      const limit = Math.max(0, Math.min(1000, Number(q.limit) || 200));
      const offset = Math.max(0, Number(q.offset) || 0);

      let items = log.slice();
      if (director) items = items.filter(e => e.director === director);
      if (agent) items = items.filter(e => e.agent === agent);
      if (emailId) items = items.filter(e => (e.email as any)?.id === emailId);
      if (phase) items = items.filter(e => e.phase === phase);
      if (sinceMs) items = items.filter(e => Date.parse(e.timestamp) >= sinceMs);
      if (untilMs) items = items.filter(e => Date.parse(e.timestamp) <= untilMs);

      // sort desc by timestamp
      items = items.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
      const total = items.length;
      const paged = items.slice(offset, offset + limit);
      return res.json({ total, items: paged });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // DELETE single diagnostic by id (delegates to cleanup service)
  app.delete('/api/orchestration/diagnostics/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const cur = await repos.getOrchestrationLog(req as any as ReqLike);
      const next = cur.filter(e => e.id !== id);
      const deleted = cur.length - next.length;
      if (deleted > 0) await services.setOrchestrationLog(next, req as any as ReqLike);
      return res.json({ success: true, deleted, message: `Deleted ${deleted} orchestration logs` });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // DELETE bulk diagnostics by ids (delegates to cleanup service)
  app.delete('/api/orchestration/diagnostics', async (req, res) => {
    try {
      const ids = Array.isArray(req.body.ids) ? (req.body.ids as string[]) : [];
      if (!ids.length) return res.status(400).json({ error: 'No ids provided' });
      const cur = await repos.getOrchestrationLog(req as any as ReqLike);
      const set = new Set(ids);
      const next = cur.filter(e => !e.id || !set.has(e.id));
      const deleted = cur.length - next.length;
      if (deleted > 0) await services.setOrchestrationLog(next, req as any as ReqLike);
      return res.json({ success: true, deleted, message: `Deleted ${deleted} orchestration logs` });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });
}

