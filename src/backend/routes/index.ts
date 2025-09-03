import express from 'express';
import { ReqLike } from '../utils/repo-access';
import registerAuthSessionRoutes from './auth-session';
import registerTestRoutes from './test';
import registerMemoryRoutes from './memory';
import registerOrchestrationRoutes from './orchestration';
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
import registerDiagnosticsRoutes from './diagnostics';
import registerDiagnosticTracesRoutes from './diagnostic-traces';
import registerUnifiedDiagnosticsRoutes from './unified-diagnostics';
import registerCleanupRoutes from './cleanup';
import { FetcherManager } from '../services/fetcher-manager';
import { ProviderEvent } from '../../shared/types';
import { LiveRepos } from '../liveRepos';

export default function registerRoutes(
  app: express.Express, 
  repos: LiveRepos,
  fetcherManager: FetcherManager,
  services: {
    setOrchestrationLog: (next: any[], req?: ReqLike) => Promise<void>;
    logProviderEvent: (e: ProviderEvent, req?: ReqLike) => Promise<void>;
    newId: () => string;
    getTraces: (req?: ReqLike) => Promise<any[]>;
    setTraces: (req: ReqLike, next: any[]) => Promise<void>;
    getProviderEvents: (req?: ReqLike) => Promise<any[]>;
  }
) {
  registerAuthSessionRoutes(app);
  registerTestRoutes(app, repos);
  registerMemoryRoutes(app, {});
  registerOrchestrationRoutes(app, repos, services);
  registerSettingsRoutes(app, {});
  registerAgentsRoutes(app, repos);
  registerFiltersRoutes(app, repos);
  registerDirectorsRoutes(app, repos);
  registerPromptsRoutes(app, repos);
  registerTemplatesRoutes(app);
  registerConversationsRoutes(app, repos, services);
  registerWorkspacesRoutes(app, repos);
  registerImprintsRoutes(app, repos);
  registerAccountsRoutes(app);
  registerDiagnosticsRoutes(app, repos);
  registerDiagnosticTracesRoutes(app, services);
  registerUnifiedDiagnosticsRoutes(app, repos, services);
  registerFetcherRoutes(app, fetcherManager, repos);
  registerCleanupRoutes(app, repos, {
    getFetcherManager: (req: ReqLike) => fetcherManager.getFetcher(req)
  });
}

