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
import { setOrchestrationLog as svcSetOrchestrationLog, logProviderEvent as svcLogProviderEvent, getOrchestrationLog, getTraces } from '../services/logging';
import { newId } from '../utils/id';
import { LiveRepos } from '../liveRepos';

export interface RouteDeps extends LiveRepos {
  fetcherManager: FetcherManager;
}

export default function registerRoutes(app: express.Express, deps: RouteDeps) {
  registerAuthSessionRoutes(app);
  registerTestRoutes(app, {
    getPrompts: deps.getPrompts,
    getDirectors: deps.getDirectors,
    getAgents: deps.getAgents,
  });
  registerMemoryRoutes(app, {});
  registerOrchestrationRoutes(app, {
    getOrchestrationLog: deps.getOrchestrationLog,
    setOrchestrationLog: (next, req?: ReqLike) => { svcSetOrchestrationLog(next, req); },
    getSettings: deps.getSettings,
  });
  registerSettingsRoutes(app, {});
  registerAgentsRoutes(app, {
    getAgents: deps.getAgents,
    setAgents: deps.setAgents,
  });
  registerFiltersRoutes(app, {
    getFilters: deps.getFilters,
    setFilters: deps.setFilters,
  });
  registerDirectorsRoutes(app, {
    getDirectors: deps.getDirectors,
    setDirectors: deps.setDirectors,
  });
  registerPromptsRoutes(app, {
    getPrompts: deps.getPrompts,
    setPrompts: deps.setPrompts,
    getSettings: deps.getSettings,
    getAgents: deps.getAgents,
    getDirectors: deps.getDirectors,
  });
  registerTemplatesRoutes(app);
  registerConversationsRoutes(app, {
    getConversations: deps.getConversations,
    setConversations: deps.setConversations,
    getSettings: deps.getSettings,
    logProviderEvent: (e: ProviderEvent, req?: ReqLike) => { svcLogProviderEvent(e, req); },
    newId,
    getDirectors: deps.getDirectors,
    getAgents: deps.getAgents,
  });
  registerWorkspacesRoutes(app, {
    getConversations: deps.getConversations,
    setConversations: deps.setConversations,
  });
  registerImprintsRoutes(app, {
    getImprints: deps.getImprints,
    setImprints: deps.setImprints,
  });
  registerAccountsRoutes(app);
  registerDiagnosticsRoutes(app, {
    getOrchestrationLog: deps.getOrchestrationLog,
    getConversations: deps.getConversations,
  });
  registerDiagnosticTracesRoutes(app, {
    getTraces: (req?: ReqLike) => deps.getTracesRepo(req).getAll(),
    setTraces: (req: ReqLike, next) => deps.getTracesRepo(req).setAll(next),
  });
  registerUnifiedDiagnosticsRoutes(app, {
    getOrchestrationLog: (req?: ReqLike) => getOrchestrationLog(req),
    getConversations: deps.getConversations,
    getProviderEvents: (req?: ReqLike) => deps.getProviderRepo(req).getAll(),
    getTraces: (req?: ReqLike) => getTraces(req),
  });
  registerFetcherRoutes(app, {
    getStatus: (req: ReqLike) => deps.fetcherManager.getStatus(req),
    startFetcherLoop: (req: ReqLike) => deps.fetcherManager.startFetcherLoop(req),
    stopFetcherLoop: (req: ReqLike) => deps.fetcherManager.stopFetcherLoop(req),
    fetchEmails: (req: ReqLike) => deps.fetcherManager.fetchEmails(req),
    getSettings: (req: ReqLike) => deps.getSettings(req),
    getFetcherLog: (req: ReqLike) => deps.fetcherManager.getFetcherLog(req),
    setFetcherLog: (req: ReqLike, next) => deps.fetcherManager.setFetcherLog(req, next),
  });
  registerCleanupRoutes(app);
}
