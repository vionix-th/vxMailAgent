import express from 'express';
import cors from 'cors';

import { requireAuth } from './middleware/auth';
import { setOrchestrationLog as svcSetOrchestrationLog, logProviderEvent as svcLogProviderEvent, getTraces } from './services/logging';
import { newId } from './utils/id';
import { ProviderEvent } from '../shared/types';

import { User, FetcherLogEntry } from '../shared/types';
import { USERS_FILE } from './utils/paths';
import { createJsonRepository } from './repository/fileRepositories';
import { setUsersRepo, getUsersRepo } from './services/users';
import { repoBundleRegistry } from './repository/registry';
import registerHealthRoutes from './routes/health';
// Cleanup routes kept (admin); health route is unauthenticated
import { FetcherManager } from './services/fetcher-manager';
import { attachUserContext, UserRequest } from './middleware/user-context';
import { ReqLike } from './utils/repo-access';
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
  const fetcherManager = new FetcherManager(repos);

  registerRoutes(app, repos, fetcherManager, {
    setOrchestrationLog: async (next: any[], req?: ReqLike) => { await svcSetOrchestrationLog(next, req); },
    logProviderEvent: async (e: ProviderEvent, req?: ReqLike) => { await svcLogProviderEvent(e, req); },
    newId,
    getTraces: async (req?: ReqLike) => await getTraces(req),
    setTraces: async (req: ReqLike, next: any[]) => { await repos.getTracesRepo(req).setAll(next); },
    getProviderEvents: async (req?: ReqLike) => await repos.getProviderRepo(req).getAll(),
  });
  
  // Bootstrapping per-user fetchers on server startup for users who enabled auto-start
  (async () => {
    try {
      const users = await getUsersRepo().getAll();
      for (const u of users) {
        const uid = (u as any).id as string;
        try {
          const bundle = await repoBundleRegistry.getBundle(uid);
          const settingsArr = await bundle.settings.getAll();
          const settings = settingsArr[0] || {};
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
        } catch (e) {
          logger.error('Boot: error preparing user bundle', { uid, err: e });
        }
      }
    } catch (e) {
      logger.error('Boot: fetcher bootstrap failed', { err: e });
    }
  })();

  return app;
}
