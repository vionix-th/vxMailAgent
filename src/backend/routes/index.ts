import express from 'express';
import { ReqLike } from '../utils/repo-access';
import registerAuthSessionRoutes from './auth-session';
import registerTestRoutes from './test';
import registerMemoryRoutes from './memory';
import registerSettingsRoutes from './settings';
import registerAgentsRoutes from './agents';
import registerFiltersRoutes from './filters';
import registerDirectorsRoutes from './directors';
import registerPromptsRoutes from './prompts';
import registerTemplatesRoutes from './templates';
import registerConversationsRoutes from './conversations';
import registerWorkspacesRoutes from './workspaces';
import registerImprintsRoutes from './imprints';
import registerAccountsRoutes from './accounts';
import registerFetcherRoutes from './fetcher';
// Legacy diagnostics routes removed (forward-only)
import registerCleanupRoutes from './cleanup';
import { createEmailRoutes } from './emails';
import { FetcherManager } from '../services/fetcher-manager';
import { LiveRepos } from '../liveRepos';
import { isProd, ENABLE_TEST_ROUTES } from '../config';
import logger from '../services/logger';

export default function registerRoutes(
  app: express.Express, 
  repos: LiveRepos,
  fetcherManager: FetcherManager,
  _services: {
    setOrchestrationLog: (next: any[], req?: ReqLike) => Promise<void>;
    getTraces: (req?: ReqLike) => Promise<any[]>;
    setTraces: (req: ReqLike, next: any[]) => Promise<void>;
    getProviderEvents: (req?: ReqLike) => Promise<any[]>;
  }
) {
  registerAuthSessionRoutes(app);
  // Test routes are disabled in production by default; enable only with explicit override
  if (!isProd || ENABLE_TEST_ROUTES) {
    if (isProd && ENABLE_TEST_ROUTES) {
      logger.warn('Enabling test routes in production by explicit override ENABLE_TEST_ROUTES=true');
    }
    registerTestRoutes(app, repos);
  }
  registerMemoryRoutes(app, {});
  // Legacy orchestration diagnostics removed
  registerSettingsRoutes(app, {});
  registerAgentsRoutes(app, repos);
  registerFiltersRoutes(app, repos);
  registerDirectorsRoutes(app, repos);
  registerPromptsRoutes(app, repos);
  registerTemplatesRoutes(app);
  registerConversationsRoutes(app, repos);
  registerWorkspacesRoutes(app, repos);
  registerImprintsRoutes(app, repos);
  registerAccountsRoutes(app);
  // Legacy diagnostics endpoints removed
  registerFetcherRoutes(app, fetcherManager, repos);
  registerCleanupRoutes(app, repos, {
    getFetcherManager: (req: ReqLike) => fetcherManager.getFetcher(req)
  });
  
  // Enhanced diagnostics routes
  app.use('/api/emails', createEmailRoutes(repos));
}
