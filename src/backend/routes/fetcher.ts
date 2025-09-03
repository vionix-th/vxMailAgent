import express from 'express';
import { saveSettings } from '../services/settings';
import logger from '../services/logger';
import { ReqLike } from '../utils/repo-access';

import { FetcherManager } from '../services/fetcher-manager';
import { LiveRepos } from '../liveRepos';

/** Register routes controlling the email fetcher. */
export default function registerFetcherRoutes(app: express.Express, fetcherManager: FetcherManager, repos: LiveRepos) {
  app.get('/api/fetcher/status', (req, res) => {
    const status = fetcherManager.getStatus(req as any as ReqLike);
    res.json(status);
  });

  app.post('/api/fetcher/start', async (req, res) => {
    fetcherManager.startFetcherLoop(req as any as ReqLike);
    const settings = await repos.getSettings(req as any as ReqLike);
    settings.fetcherAutoStart = true;
    try {
      await saveSettings(settings, req as any as ReqLike);
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
    res.json({ success: true, active: fetcherManager.getStatus(req as any as ReqLike).active });
  });

  app.post('/api/fetcher/stop', async (req, res) => {
    fetcherManager.stopFetcherLoop(req as any as ReqLike);
    const settings = await repos.getSettings(req as any as ReqLike);
    settings.fetcherAutoStart = false;
    try {
      await saveSettings(settings, req as any as ReqLike);
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
    res.json({ success: true, active: fetcherManager.getStatus(req as any as ReqLike).active });
  });

  app.post('/api/fetcher/fetch', async (req, res) => {
    try {
      await fetcherManager.fetchEmails(req as any as ReqLike);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/fetcher/run', async (req, res) => {
    logger.info('[FETCHER] Manual fetch triggered');
    await fetcherManager.fetchEmails(req as any as ReqLike);
    res.json({ success: true });
  });

  app.get('/api/fetcher/logs', (req, res) => {
    try {
      const log = fetcherManager.getFetcherLog(req as any as ReqLike);
      res.json(log);
    } catch (e) {
      logger.error('Failed to read fetcherLog', { err: e });
      res.status(500).json({ error: 'Failed to read fetcher logs' });
    }
  });

  // Note: Full purge moved to cleanup routes (/api/cleanup/fetcher-logs)

  app.delete('/api/fetcher/logs/:id', (req, res) => {
    try {
      const id = req.params.id;
      const cur = fetcherManager.getFetcherLog(req as any as ReqLike);
      const next = cur.filter((e) => e.id !== id);
      const deleted = cur.length - next.length;
      fetcherManager.setFetcherLog(req as any as ReqLike, next);
      return res.json({ success: true, deleted, message: `Deleted ${deleted} fetcher logs` });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.delete('/api/fetcher/logs', (req, res) => {
    try {
      const ids = Array.isArray(req.body.ids) ? (req.body.ids as string[]) : [];
      if (!ids.length) return res.status(400).json({ error: 'No ids provided' });
      const cur = fetcherManager.getFetcherLog(req as any as ReqLike);
      const idSet = new Set(ids);
      const next = cur.filter((e) => !e.id || !idSet.has(e.id));
      const deleted = cur.length - next.length;
      fetcherManager.setFetcherLog(req as any as ReqLike, next);
      return res.json({ success: true, deleted, message: `Deleted ${deleted} fetcher logs` });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });
}
