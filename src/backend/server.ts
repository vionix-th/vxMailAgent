import express from 'express';

import { requireAuth } from './middleware/auth';
import { setOrchestrationLog as svcSetOrchestrationLog, getTraces } from './services/logging';

import registerHealthRoutes from './routes/health';
// Cleanup routes kept (admin); health route is unauthenticated
import { FetcherManager } from './services/fetcher-manager';
import { attachUserContext } from './middleware/user-context';
import { ReqLike } from './utils/repo-access';
import { initRepos } from './initRepos';
import registerRoutes from './routes';
import { errorHandler, NotFoundError } from './services/error-handler';
import {
  configureSecurityHeaders,
  configureCors,
  configureParsersAndRequestLogging,
  configureHttpsEnforcement,
} from './bootstrap/app';
 

/** Create and configure the backend Express server. */
export function createServer() {
  const app = express();
  const repos = initRepos();

  // App configuration (security headers, CORS, parsers, logging, HTTPS)
  configureSecurityHeaders(app);
  configureCors(app);
  configureParsersAndRequestLogging(app);
  configureHttpsEnforcement(app);

  // Public health check (unauthenticated)
  registerHealthRoutes(app);

  app.use(requireAuth);
  app.use(attachUserContext);
  const fetcherManager = new FetcherManager(repos);

  registerRoutes(app, repos, fetcherManager, {
    setOrchestrationLog: async (next: any[], req?: ReqLike) => { await svcSetOrchestrationLog(next, req); },
    getTraces: async (req?: ReqLike) => await getTraces(req),
    setTraces: async (req: ReqLike, next: any[]) => { await repos.getTracesRepo(req).setAll(next); },
    getProviderEvents: async (req?: ReqLike) => await repos.getProviderRepo(req).getAll(),
  });

  // Centralized 404 handler (must be after routes)
  app.use((req, res) => {
    const ua = req.headers?.['user-agent'] as string | undefined;
    const ip = (req as any)?.ip || (req as any)?.connection?.remoteAddress;
    const context = {
      uid: (req as any)?.auth?.uid,
      operation: `${req.method} ${req.path}`,
      resource: req.path,
      ...(ua ? { userAgent: ua } : {}),
      ...(ip ? { ip } : {}),
    } as const;
    errorHandler.handleError(new NotFoundError('Route not found'), res, context as any);
  });

  // Centralized error-handling middleware
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, req: any, res: any, _next: any) => {
    const ua = req?.headers?.['user-agent'] as string | undefined;
    const ip = req?.ip || req?.connection?.remoteAddress;
    const context = {
      uid: req?.auth?.uid,
      operation: `${req?.method} ${req?.path}`,
      resource: req?.path,
      ...(ua ? { userAgent: ua } : {}),
      ...(ip ? { ip } : {}),
    } as const;
    const e = err instanceof Error ? err : new Error(String(err));
    errorHandler.handleError(e, res, context as any);
  });

  return { app, fetcherManager } as const;
}

