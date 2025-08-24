import express from 'express';
import { OrchestrationDiagnosticEntry } from '../../shared/types';
import { createCleanupService, RepositoryHub } from '../services/cleanup';

export interface OrchestrationRoutesDeps {
  getOrchestrationLog: () => OrchestrationDiagnosticEntry[];
  setOrchestrationLog: (next: OrchestrationDiagnosticEntry[]) => void;
  getSettings: () => any;
}

 

export default function registerOrchestrationRoutes(app: express.Express, deps: OrchestrationRoutesDeps) {
  const hub: RepositoryHub = {
    getFetcherLog: () => [],
    setFetcherLog: () => {},
    getOrchestrationLog: () => deps.getOrchestrationLog() as any[],
    setOrchestrationLog: (next: any[]) => deps.setOrchestrationLog(next as any),
    getConversations: () => [],
    setConversations: () => {},
    getProviderEvents: () => [],
    setProviderEvents: () => {},
    getTraces: () => [],
    setTraces: () => {},
  };
  const cleanup = createCleanupService(hub);
  // GET diagnostics: via repository with filters and pagination
  // /api/orchestration/diagnostics?director=&agent=&emailId=&phase=&since=&until=&limit=&offset=
  app.get('/api/orchestration/diagnostics', (req, res) => {
    let log: OrchestrationDiagnosticEntry[] = [];
    try { log = deps.getOrchestrationLog() || []; } catch (e) { console.error('[ERROR] getOrchestrationLog failed:', e); }

    try {
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
  app.delete('/api/orchestration/diagnostics/:id', (req, res) => {
    try {
      const id = req.params.id;
      const { deleted } = cleanup.removeOrchestrationByIds([id]);
      return res.json({ success: true, deleted, message: `Deleted ${deleted} orchestration logs` });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // DELETE bulk diagnostics by ids (delegates to cleanup service)
  app.delete('/api/orchestration/diagnostics', (req, res) => {
    try {
      const ids = Array.isArray(req.body.ids) ? (req.body.ids as string[]) : [];
      if (!ids.length) return res.status(400).json({ error: 'No ids provided' });
      const { deleted } = cleanup.removeOrchestrationByIds(ids);
      return res.json({ success: true, deleted, message: `Deleted ${deleted} orchestration logs` });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });
}
