import express from 'express';
import { UserRequest } from '../middleware/user-context';
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
    setOrchestrationLog: (next, req?: UserRequest) => { svcSetOrchestrationLog(next, req); },
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
    logProviderEvent: (e: ProviderEvent, req?: UserRequest) => { svcLogProviderEvent(e, req); },
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
    getTraces: (req?: UserRequest) => deps.getTracesRepo(req).getAll(),
    setTraces: (req: UserRequest, next) => deps.getTracesRepo(req).setAll(next),
  });
  registerUnifiedDiagnosticsRoutes(app, {
    getOrchestrationLog: (req?: UserRequest) => getOrchestrationLog(req),
    getConversations: deps.getConversations,
    getProviderEvents: (req?: UserRequest) => deps.getProviderRepo(req).getAll(),
    getTraces: (req?: UserRequest) => getTraces(req),
  });
  registerFetcherRoutes(app, {
    getStatus: (req: UserRequest) => deps.fetcherManager.getStatus(req),
    startFetcherLoop: (req: UserRequest) => deps.fetcherManager.startFetcherLoop(req),
    stopFetcherLoop: (req: UserRequest) => deps.fetcherManager.stopFetcherLoop(req),
    fetchEmails: (req: UserRequest) => deps.fetcherManager.fetchEmails(req),
    getSettings: (req: UserRequest) => deps.getSettings(req),
    getFetcherLog: (req: UserRequest) => deps.fetcherManager.getFetcherLog(req),
    setFetcherLog: (req: UserRequest, next) => deps.fetcherManager.setFetcherLog(req, next),
  });
  registerCleanupRoutes(app);
}
