import express from 'express';
import * as persistence from '../persistence';
import { SETTINGS_FILE } from '../utils/paths';
import { FetcherLogEntry } from '../../shared/types';
import { createCleanupService, RepositoryHub } from '../services/cleanup';


export interface FetcherRoutesDeps {
  getStatus: () => { active: boolean; running?: boolean; lastRun: string | null; nextRun: string | null; accountStatus: Record<string, { lastRun: string | null; lastError: string | null }> };
  startFetcherLoop: () => void;
  stopFetcherLoop: () => void;
  fetchEmails: () => Promise<void>;
  getSettings: () => any;
  getFetcherLog: () => FetcherLogEntry[];
  setFetcherLog: (next: FetcherLogEntry[]) => void;
}

export default function registerFetcherRoutes(app: express.Express, deps: FetcherRoutesDeps) {
  const hub: RepositoryHub = {
    getFetcherLog: () => deps.getFetcherLog(),
    setFetcherLog: (next: FetcherLogEntry[]) => deps.setFetcherLog(next),
    // Unused domains for these endpoints
    getOrchestrationLog: () => [],
    setOrchestrationLog: () => {},
    getConversations: () => [],
    setConversations: () => {},
    getProviderEvents: () => [],
    setProviderEvents: () => {},
    getTraces: () => [],
    setTraces: () => {},
    getWorkspaceItems: () => [],
    setWorkspaceItems: () => {},
  };
  const cleanup = createCleanupService(hub);
  // GET /api/fetcher/status
  app.get('/api/fetcher/status', (_req, res) => {
    const status = deps.getStatus();
    res.json(status);
  });

  // POST /api/fetcher/start
  app.post('/api/fetcher/start', (_req, res) => {
    deps.startFetcherLoop();
    // Persist desired state
    const settings = deps.getSettings();
    settings.fetcherAutoStart = true;
    try { persistence.encryptAndPersist(settings, SETTINGS_FILE); } catch {}
    res.json({ success: true, active: deps.getStatus().active });
  });

  // POST /api/fetcher/stop
  app.post('/api/fetcher/stop', (_req, res) => {
    deps.stopFetcherLoop();
    // Persist desired state
    const settings = deps.getSettings();
    settings.fetcherAutoStart = false;
    try { persistence.encryptAndPersist(settings, SETTINGS_FILE); } catch {}
    res.json({ success: true, active: deps.getStatus().active });
  });

  // POST /api/fetcher/trigger (non-blocking)
  app.post('/api/fetcher/trigger', (_req, res) => {
    deps.fetchEmails();
    res.json({ success: true });
  });

  // POST /api/fetcher/run (awaits completion)
  app.post('/api/fetcher/run', async (_req, res) => {
    console.log(`[${new Date().toISOString()}] [FETCHER] Manual fetch triggered`);
    await deps.fetchEmails();
    res.json({ success: true });
  });

  // GET /api/fetcher/logs (display-only): via repository
  app.get('/api/fetcher/logs', (_req, res) => {
    try {
      const log = deps.getFetcherLog();
      res.json(log);
    } catch (e) {
      console.error('[ERROR] Failed to read fetcherLog:', e);
      res.status(500).json({ error: 'Failed to read fetcher logs' });
    }
  });

  // DELETE single log by id (delegates to cleanup service)
  app.delete('/api/fetcher/logs/:id', (req, res) => {
    try {
      const id = req.params.id;
      const { deleted } = cleanup.removeFetcherLogsByIds([id]);
      return res.json({ success: true, deleted, message: `Deleted ${deleted} fetcher logs` });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // DELETE bulk logs by ids array (delegates to cleanup service)
  app.delete('/api/fetcher/logs', (req, res) => {
    try {
      const ids = Array.isArray(req.body.ids) ? (req.body.ids as string[]) : [];
      if (!ids.length) return res.status(400).json({ error: 'No ids provided' });
      const { deleted } = cleanup.removeFetcherLogsByIds(ids);
      return res.json({ success: true, deleted, message: `Deleted ${deleted} fetcher logs` });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });
}
