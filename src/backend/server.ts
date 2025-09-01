import express from 'express';
import cors from 'cors';

import { requireAuth } from './middleware/auth';
import { logOrch as svcLogOrch, logProviderEvent as svcLogProviderEvent } from './services/logging';

import { User, FetcherLogEntry } from '../shared/types';
import { USERS_FILE } from './utils/paths';
import { createJsonRepository } from './repository/fileRepositories';
import { setUsersRepo, getUsersRepo } from './services/users';
import { repoBundleRegistry } from './repository/registry';
import registerHealthRoutes from './routes/health';
// Cleanup routes kept (admin); health route is unauthenticated
import { FetcherManager } from './services/fetcher-manager';
import { createToolHandler } from './toolCalls';
import { attachUserContext, UserRequest } from './middleware/user-context';
import logger from './services/logger';
import { createLiveRepos } from './liveRepos';
import registerRoutes from './routes';

/** Create and configure the backend Express server. */
export function createServer() {
  const app = express();
  const repos = createLiveRepos();

  app.use((req, res, next) => {
    void req; // satisfy noUnusedParameters
    res.setHeader('Content-Security-Policy', "script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; object-src 'none'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  
  const origin = (process.env.CORS_ORIGIN || '*');
  if (origin && origin !== '*') app.use(cors({ origin, credentials: true }));
  else app.use(cors());
  app.use(express.json());
  app.use((req, res, next) => { void res; logger.info('HTTP request', { method: req.method, url: req.url }); next(); });
  if ((process.env.NODE_ENV || 'development') === 'production') {
    app.enable('trust proxy');
    app.use((req, res, next) => {
      const xfProto = String(req.headers['x-forwarded-proto'] || '');
      if (req.secure || xfProto === 'https') return next();
      const host = req.headers.host;
      res.redirect(301, `https://${host}${req.url}`);
    });
    app.use((req, res, next) => { void req; res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains'); next(); });
  }

  // Public health check (unauthenticated)
  registerHealthRoutes(app);

  app.use(requireAuth);
  app.use(attachUserContext);
  // System-level repositories: only users registry remains
  const usersRepo = createJsonRepository<User>(USERS_FILE);
  setUsersRepo(usersRepo);
  const fetcherManager = new FetcherManager((uid: string) => {
    const userBundle = repoBundleRegistry.getBundle(uid);

    return {
      uid,
      getSettings: () => userBundle.settings.getAll()[0] || {},
      getFilters: () => userBundle.filters.getAll(),
      getDirectors: () => userBundle.directors.getAll(),
      getAgents: () => userBundle.agents.getAll(),
      getPrompts: () => userBundle.prompts.getAll(),
      getConversations: () => userBundle.conversations.getAll(),
      setConversations: (next: any[]) => userBundle.conversations.setAll(next),
      getAccounts: () => userBundle.accounts.getAll(),
      setAccounts: (accounts: any[]) => userBundle.accounts.setAll(accounts),
      logOrch: (e: any) => {
        const mockReq = { userContext: { uid, repos: userBundle } } as any;
        svcLogOrch(e, mockReq);
      },
      logProviderEvent: (e: any) => {
        const mockReq = { userContext: { uid, repos: userBundle } } as any;
        svcLogProviderEvent(e, mockReq);
      },
      getFetcherLog: () => userBundle.fetcherLog.getAll(),
      setFetcherLog: (next: any[]) => userBundle.fetcherLog.setAll(next),
      getToolHandler: () => createToolHandler(userBundle),
      getUserReq: () => ({ userContext: { uid, repos: userBundle } } as any),
    };
  });

  registerRoutes(app, { ...repos, fetcherManager });
  
  // Bootstrapping per-user fetchers on server startup for users who enabled auto-start
  try {
    const users = getUsersRepo().getAll();
    for (const u of users) {
      const uid = u.id;
      const bundle = repoBundleRegistry.getBundle(uid);
      const settings = bundle.settings.getAll()[0] || {};
      if (settings.fetcherAutoStart) {
        const mockReq = { userContext: { uid, repos: bundle } } as any as UserRequest;
        try {
          fetcherManager.startFetcherLoop(mockReq);
          logger.info('Boot: started fetcher loop', { uid });
          // Log to per-user fetcher log as well
          const cur: FetcherLogEntry[] = fetcherManager.getFetcherLog(mockReq) as any;
          const entry: FetcherLogEntry = { timestamp: new Date().toISOString(), level: 'info', event: 'boot_autostart', message: 'Fetcher loop auto-started on server boot' } as any;
          fetcherManager.setFetcherLog(mockReq, [...cur, entry] as any);
        } catch (e) {
          logger.error('Boot: failed to start fetcher loop', { uid, err: e });
          try {
            const cur: FetcherLogEntry[] = fetcherManager.getFetcherLog(mockReq) as any;
            const entry: FetcherLogEntry = { timestamp: new Date().toISOString(), level: 'error', event: 'boot_autostart_failed', message: 'Failed to auto-start fetcher loop on server boot', detail: String((e as any)?.message || e) } as any;
            fetcherManager.setFetcherLog(mockReq, [...cur, entry] as any);
          } catch {}
        }
      }
    }
  } catch (e) {
    logger.error('Boot: fetcher bootstrap failed', { err: e });
  }

  return app;
}
