import express from 'express';
import { FetcherLogEntry } from '../../shared/types';
import { createCleanupService, RepositoryHub } from '../services/cleanup';
import { UserRequest } from '../middleware/user-context';
import { saveSettings } from '../services/settings';

/** Dependencies for fetcher routes. */
export interface FetcherRoutesDeps {
  getStatus: (req?: UserRequest) => { active: boolean; running?: boolean; lastRun: string | null; nextRun: string | null; accountStatus: Record<string, { lastRun: string | null; lastError: string | null }> };
  startFetcherLoop: (req?: UserRequest) => void;
  stopFetcherLoop: (req?: UserRequest) => void;
  fetchEmails: (req?: UserRequest) => Promise<void>;
  getSettings: () => any;
  getFetcherLog: (req?: UserRequest) => FetcherLogEntry[];
  setFetcherLog: (req: UserRequest, next: FetcherLogEntry[]) => void;
}

/** Register routes controlling the email fetcher. */
export default function registerFetcherRoutes(app: express.Express, deps: FetcherRoutesDeps) {
  function makeCleanup(req: UserRequest) {
    const hub: RepositoryHub = {
      getFetcherLog: () => deps.getFetcherLog(req),
      setFetcherLog: (next: FetcherLogEntry[]) => deps.setFetcherLog(req, next),
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
    return createCleanupService(hub);
  }
  app.get('/api/fetcher/status', (req, res) => {
    const status = deps.getStatus(req as UserRequest);
    res.json(status);
  });

  app.post('/api/fetcher/start', (req, res) => {
    deps.startFetcherLoop(req as UserRequest);
    const settings = deps.getSettings();
    settings.fetcherAutoStart = true;
    try { saveSettings(settings, req as UserRequest); } catch {}
    res.json({ success: true, active: deps.getStatus(req as UserRequest).active });
  });

  app.post('/api/fetcher/stop', (req, res) => {
    deps.stopFetcherLoop(req as UserRequest);
    const settings = deps.getSettings();
    settings.fetcherAutoStart = false;
    try { saveSettings(settings, req as UserRequest); } catch {}
    res.json({ success: true, active: deps.getStatus(req as UserRequest).active });
  });

  app.post('/api/fetcher/fetch', async (req, res) => {
    try {
      await deps.fetchEmails(req as UserRequest);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/fetcher/run', async (req, res) => {
    console.log(`[${new Date().toISOString()}] [FETCHER] Manual fetch triggered`);
    await deps.fetchEmails(req as UserRequest);
    res.json({ success: true });
  });

  app.get('/api/fetcher/log', (req, res) => {
    const log = deps.getFetcherLog(req as UserRequest);
    res.json(log);
  });

  app.get('/api/fetcher/logs', (req, res) => {
    try {
      const log = deps.getFetcherLog(req as UserRequest);
      res.json(log);
    } catch (e) {
      console.error('[ERROR] Failed to read fetcherLog:', e);
      res.status(500).json({ error: 'Failed to read fetcher logs' });
    }
  });

  // Purge all fetcher logs for current user
  app.delete('/api/fetcher/logs/purge', (req, res) => {
    try {
      const cleanup = makeCleanup(req as UserRequest);
      const out = cleanup.purge('fetcher');
      res.json({ success: true, ...out });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.delete('/api/fetcher/logs/:id', (req, res) => {
    try {
      const id = req.params.id;
      const cleanup = makeCleanup(req as UserRequest);
      const { deleted } = cleanup.removeFetcherLogsByIds([id]);
      return res.json({ success: true, deleted, message: `Deleted ${deleted} fetcher logs` });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.delete('/api/fetcher/logs', (req, res) => {
    try {
      const ids = Array.isArray(req.body.ids) ? (req.body.ids as string[]) : [];
      if (!ids.length) return res.status(400).json({ error: 'No ids provided' });
      const cleanup = makeCleanup(req as UserRequest);
      const { deleted } = cleanup.removeFetcherLogsByIds(ids);
      return res.json({ success: true, deleted, message: `Deleted ${deleted} fetcher logs` });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });
}
