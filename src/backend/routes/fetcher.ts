import express from 'express';
import { saveSettings } from '../services/settings';
import logger from '../services/logger';
import { ReqLike } from '../utils/repo-access';
import { errorHandler, ValidationError } from '../services/error-handler';

import { FetcherManager } from '../services/fetcher-manager';
import { LiveRepos } from '../liveRepos';

/** Register routes controlling the email fetcher. */
export default function registerFetcherRoutes(app: express.Express, fetcherManager: FetcherManager, repos: LiveRepos) {
  app.get('/api/fetcher/status', errorHandler.wrapAsync((req: express.Request, res: express.Response) => {
    const status = fetcherManager.getStatus(req as any as ReqLike);
    res.json(status);
  }));

  app.post('/api/fetcher/start', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    fetcherManager.startFetcherLoop(req as any as ReqLike);
    const settings = await repos.getSettings(req as any as ReqLike);
    settings.fetcherAutoStart = true;
    await saveSettings(settings, req as any as ReqLike);
    res.json({ success: true, active: fetcherManager.getStatus(req as any as ReqLike).active });
  }));

  app.post('/api/fetcher/stop', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    fetcherManager.stopFetcherLoop(req as any as ReqLike);
    const settings = await repos.getSettings(req as any as ReqLike);
    settings.fetcherAutoStart = false;
    await saveSettings(settings, req as any as ReqLike);
    res.json({ success: true, active: fetcherManager.getStatus(req as any as ReqLike).active });
  }));

  app.post('/api/fetcher/fetch', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    await fetcherManager.fetchEmails(req as any as ReqLike);
    res.json({ success: true });
  }));

  app.post('/api/fetcher/run', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    logger.info('[FETCHER] Manual fetch triggered');
    await fetcherManager.fetchEmails(req as any as ReqLike);
    res.json({ success: true });
  }));

  app.get('/api/fetcher/logs', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const log = await fetcherManager.getFetcherLog(req as any as ReqLike);
    res.json(log);
  }));

  // Note: Full purge moved to cleanup routes (/api/cleanup/fetcher-logs)

  app.delete('/api/fetcher/logs/:id', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    const cur = await fetcherManager.getFetcherLog(req as any as ReqLike);
    const next = cur.filter((e) => e.id !== id);
    const deleted = cur.length - next.length;
    await fetcherManager.setFetcherLog(req as any as ReqLike, next);
    return res.json({ success: true, deleted, message: `Deleted ${deleted} fetcher logs` });
  }));

  app.delete('/api/fetcher/logs', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const ids = Array.isArray(req.body.ids) ? (req.body.ids as string[]) : [];
    if (!ids.length) throw new ValidationError('No ids provided');
    const cur = await fetcherManager.getFetcherLog(req as any as ReqLike);
    const idSet = new Set(ids);
    const next = cur.filter((e: any) => !e.id || !idSet.has(e.id));
    const deleted = cur.length - next.length;
    await fetcherManager.setFetcherLog(req as any as ReqLike, next);
    return res.json({ success: true, deleted, message: `Deleted ${deleted} fetcher logs` });
  }));
}
