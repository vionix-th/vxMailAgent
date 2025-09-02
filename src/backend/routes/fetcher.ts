import express from 'express';
import { FetcherLogEntry } from '../../shared/types';
import { createCleanupService, RepositoryHub } from '../services/cleanup';
import { saveSettings } from '../services/settings';
import logger from '../services/logger';
import { requireReq, repoGetAll, repoSetAll, ReqLike } from '../utils/repo-access';

/** Dependencies for fetcher routes. */
export interface FetcherRoutesDeps {
  getStatus: (req: ReqLike) => { active: boolean; running?: boolean; lastRun: string | null; nextRun: string | null; accountStatus: Record<string, { lastRun: string | null; lastError: string | null }> };
  startFetcherLoop: (req: ReqLike) => void;
  stopFetcherLoop: (req: ReqLike) => void;
  fetchEmails: (req: ReqLike) => Promise<void>;
  getSettings: (req: ReqLike) => any;
  getFetcherLog: (req: ReqLike) => FetcherLogEntry[];
  setFetcherLog: (req: ReqLike, next: FetcherLogEntry[]) => void;
}

/** Register routes controlling the email fetcher. */
export default function registerFetcherRoutes(app: express.Express, deps: FetcherRoutesDeps) {
  function makeCleanup(req: ReqLike) {
    const ureq = requireReq(req);
    const hub: RepositoryHub = {
      // Use per-user repositories consistently (mirrors routes/cleanup.ts)
      getConversations: () => repoGetAll<any>(ureq, 'conversations'),
      setConversations: (next: any[]) => repoSetAll<any>(ureq, 'conversations', next),
      getOrchestrationLog: () => repoGetAll<any>(ureq, 'orchestrationLog'),
      setOrchestrationLog: (next: any[]) => repoSetAll<any>(ureq, 'orchestrationLog', next),
      getProviderEvents: () => repoGetAll<any>(ureq, 'providerEvents'),
      setProviderEvents: (next: any[]) => repoSetAll<any>(ureq, 'providerEvents', next),
      getTraces: () => repoGetAll<any>(ureq, 'traces'),
      setTraces: (next: any[]) => repoSetAll<any>(ureq, 'traces', next),
      getFetcherLog: () => repoGetAll<any>(ureq, 'fetcherLog'),
      setFetcherLog: (next: any[]) => repoSetAll<any>(ureq, 'fetcherLog', next),
      getWorkspaceItems: () => repoGetAll<any>(ureq, 'workspaceItems'),
      setWorkspaceItems: (next: any[]) => repoSetAll<any>(ureq, 'workspaceItems', next),
    };
    return createCleanupService(hub);
  }
  app.get('/api/fetcher/status', (req, res) => {
    const status = deps.getStatus(req as any as ReqLike);
    res.json(status);
  });

  app.post('/api/fetcher/start', (req, res) => {
    deps.startFetcherLoop(req as any as ReqLike);
    const settings = deps.getSettings(req as any as ReqLike);
    settings.fetcherAutoStart = true;
    try { saveSettings(settings, req as any as ReqLike); } catch {}
    res.json({ success: true, active: deps.getStatus(req as any as ReqLike).active });
  });

  app.post('/api/fetcher/stop', (req, res) => {
    deps.stopFetcherLoop(req as any as ReqLike);
    const settings = deps.getSettings(req as any as ReqLike);
    settings.fetcherAutoStart = false;
    try { saveSettings(settings, req as any as ReqLike); } catch {}
    res.json({ success: true, active: deps.getStatus(req as any as ReqLike).active });
  });

  app.post('/api/fetcher/fetch', async (req, res) => {
    try {
      await deps.fetchEmails(req as any as ReqLike);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/fetcher/run', async (req, res) => {
    logger.info('[FETCHER] Manual fetch triggered');
    await deps.fetchEmails(req as any as ReqLike);
    res.json({ success: true });
  });

  app.get('/api/fetcher/logs', (req, res) => {
    try {
      const log = deps.getFetcherLog(req as any as ReqLike);
      res.json(log);
    } catch (e) {
      logger.error('Failed to read fetcherLog', { err: e });
      res.status(500).json({ error: 'Failed to read fetcher logs' });
    }
  });

  // Purge all fetcher logs for current user
  app.delete('/api/fetcher/logs/purge', (req, res) => {
    try {
      const cleanup = makeCleanup(req as any as ReqLike);
      const out = cleanup.purge('fetcher');
      res.json({ success: true, ...out });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.delete('/api/fetcher/logs/:id', (req, res) => {
    try {
      const id = req.params.id;
      const cleanup = makeCleanup(req as any as ReqLike);
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
      const cleanup = makeCleanup(req as any as ReqLike);
      const { deleted } = cleanup.removeFetcherLogsByIds(ids);
      return res.json({ success: true, deleted, message: `Deleted ${deleted} fetcher logs` });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });
}
