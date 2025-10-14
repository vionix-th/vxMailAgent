import express from 'express';
import { saveSettings } from '../services/settings';
import logger from '../services/logger';
import { requireContext } from '../utils/repo-access';
import { errorHandler, ValidationError } from '../services/error-handler';

import { FetcherManager } from '../services/fetcher-manager';
import { LiveRepos } from '../liveRepos';

/** Register routes controlling the email fetcher. */
export default function registerFetcherRoutes(app: express.Express, fetcherManager: FetcherManager, repos: LiveRepos) {
  app.get('/api/fetcher/status', errorHandler.wrapAsync((req: express.Request, res: express.Response) => {
    const status = fetcherManager.getStatus(requireContext(req));
    res.json(status);
  }));

  app.post('/api/fetcher/start', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const context = requireContext(req);
    fetcherManager.startFetcherLoop(context);
    const settings = await repos.getSettings(context);
    settings.fetcherAutoStart = true;
    await saveSettings(settings, context);
    res.json({ success: true, active: fetcherManager.getStatus(context).active });
  }));

  app.post('/api/fetcher/stop', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const context = requireContext(req);
    fetcherManager.stopFetcherLoop(context);
    const settings = await repos.getSettings(context);
    settings.fetcherAutoStart = false;
    await saveSettings(settings, context);
    res.json({ success: true, active: fetcherManager.getStatus(context).active });
  }));

  app.post('/api/fetcher/fetch', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    await fetcherManager.fetchEmails(requireContext(req));
    res.json({ success: true });
  }));

  app.post('/api/fetcher/run', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    logger.info('[FETCHER] Manual fetch triggered');
    await fetcherManager.fetchEmails(requireContext(req));
    res.json({ success: true });
  }));

  app.get('/api/fetcher/logs', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const log = await fetcherManager.getFetcherLog(requireContext(req));
    res.json(log);
  }));

  // Note: Full purge moved to cleanup routes (/api/cleanup/fetcher-logs)

  app.delete('/api/fetcher/logs/:id', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    const deleted = await fetcherManager.deleteFetcherLog(requireContext(req), id) ? 1 : 0;
    return res.json({ success: true, deleted, message: `Deleted ${deleted} fetcher logs` });
  }));

  app.delete('/api/fetcher/logs', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const ids = Array.isArray(req.body.ids) ? (req.body.ids as string[]) : [];
    if (!ids.length) throw new ValidationError('No ids provided');
    const deleted = await fetcherManager.deleteFetcherLogs(requireContext(req), ids);
    return res.json({ success: true, deleted, message: `Deleted ${deleted} fetcher logs` });
  }));
}
