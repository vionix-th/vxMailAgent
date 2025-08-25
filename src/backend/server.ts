import express from 'express';
import cors from 'cors';

import authRouter from './auth';
import { loadSettings } from './services/settings';
import { isDirectorFinalized as svcIsDirectorFinalized } from './services/conversations';
import { initLogging, setOrchestrationLog as svcSetOrchestrationLog, logOrch as svcLogOrch, logProviderEvent as svcLogProviderEvent } from './services/logging';

import { Filter, Director, Agent, Prompt, Imprint, MemoryEntry, OrchestrationDiagnosticEntry, ConversationThread, ProviderEvent, WorkspaceItem } from '../shared/types';
import { PROMPTS_FILE, IMPRINTS_FILE, CONVERSATIONS_FILE, ORCHESTRATION_LOG_FILE, MEMORY_FILE, AGENTS_FILE, DIRECTORS_FILE, FILTERS_FILE, WORKSPACE_ITEMS_FILE } from './utils/paths';
import { newId } from './utils/id';
import { setMemoryRepo, setWorkspaceRepo } from './toolCalls';
import { createJsonRepository, FileProviderEventsRepository, FileTracesRepository } from './repository/fileRepositories';

import registerTestRoutes from './routes/test';
import registerMemoryRoutes from './routes/memory';
import registerOrchestrationRoutes from './routes/orchestration';
import registerSettingsRoutes from './routes/settings';
import registerAgentsRoutes from './routes/agents';
import registerFiltersRoutes from './routes/filters';
import registerDirectorsRoutes from './routes/directors';
import registerPromptsRoutes from './routes/prompts';
import registerTemplatesRoutes from './routes/templates';
import registerConversationsRoutes from './routes/conversations';
import registerWorkspacesRoutes from './routes/workspaces';
import registerImprintsRoutes from './routes/imprints';
import registerAccountsRoutes from './routes/accounts';
import registerFetcherRoutes from './routes/fetcher';
import registerDiagnosticsRoutes from './routes/diagnostics';
import registerDiagnosticTracesRoutes from './routes/diagnostic-traces';
import registerUnifiedDiagnosticsRoutes from './routes/unified-diagnostics';
import registerHealthRoutes from './routes/health';
import registerCleanupRoutes from './routes/cleanup';
import { initFetcher } from './services/fetcher';

/** Configure and return the Express application with all routes and services. */
export function createServer() {
  const app = express();

  let settings = loadSettings();

  function getPromptsLive(): Prompt[] { return promptsRepo.getAll(); }


  function getAgentsLive(): Agent[] { return agentsRepo.getAll(); }
  function getDirectorsLive(): Director[] { return directorsRepo.getAll(); }
  function getFiltersLive(): Filter[] { return filtersRepo.getAll(); }
  function getImprintsLive(): Imprint[] { return imprintsRepo.getAll(); }
  function getOrchestrationLogLive(): OrchestrationDiagnosticEntry[] { return orchRepo.getAll(); }
  function getConversationsLive(): ConversationThread[] { return conversationsRepo.getAll(); }
  function getSettingsLive() { settings = loadSettings(); return settings; }

  function isDirectorFinalized(dirId: string): boolean { return svcIsDirectorFinalized(conversations, dirId); }

  app.use((req, res, next) => {
    void req; // satisfy noUnusedParameters
    res.setHeader('Content-Security-Policy', "script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; object-src 'none'");
    next();
  });
  app.use(cors());
  app.use(express.json());
  app.use('/api', authRouter);
  app.use((req, res, next) => { void res; console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`); next(); });

  let conversations: ConversationThread[] = [];

  const memoryRepo = createJsonRepository<MemoryEntry>(MEMORY_FILE);
  setMemoryRepo(memoryRepo);
  
  const workspaceRepo = createJsonRepository<WorkspaceItem>(WORKSPACE_ITEMS_FILE);
  setWorkspaceRepo(workspaceRepo);
  const orchRepo = createJsonRepository<OrchestrationDiagnosticEntry>(ORCHESTRATION_LOG_FILE);
  const promptsRepo = createJsonRepository<Prompt>(PROMPTS_FILE);
  const imprintsRepo = createJsonRepository<Imprint>(IMPRINTS_FILE);
  const conversationsRepo = createJsonRepository<ConversationThread>(CONVERSATIONS_FILE);
  const agentsRepo = createJsonRepository<Agent>(AGENTS_FILE);
  const directorsRepo = createJsonRepository<Director>(DIRECTORS_FILE);
  const filtersRepo = createJsonRepository<Filter>(FILTERS_FILE);
  const providerRepo = new FileProviderEventsRepository();
  const tracesRepo = new FileTracesRepository();

  initLogging({ orchRepo, providerRepo, tracesRepo });

  registerTestRoutes(app, { getSettings: () => getSettingsLive(), getPrompts: () => getPromptsLive(), getDirectors: () => getDirectorsLive(), getAgents: () => getAgentsLive() });
  registerMemoryRoutes(app, { getMemory: () => memoryRepo.getAll(), setMemory: (next: MemoryEntry[]) => { memoryRepo.setAll(next); } });
  registerOrchestrationRoutes(app, { getOrchestrationLog: () => getOrchestrationLogLive(), setOrchestrationLog: (next: OrchestrationDiagnosticEntry[]) => { svcSetOrchestrationLog(next); }, getSettings: () => getSettingsLive() });
  registerSettingsRoutes(app, { getSettings: () => getSettingsLive() });
  registerAgentsRoutes(app, { getAgents: () => getAgentsLive(), setAgents: (next: Agent[]) => { agentsRepo.setAll(next); } });
  registerFiltersRoutes(app, { getFilters: () => getFiltersLive(), setFilters: (next: Filter[]) => { filtersRepo.setAll(next); } });
  registerDirectorsRoutes(app, { getDirectors: () => getDirectorsLive(), setDirectors: (next: Director[]) => { directorsRepo.setAll(next); } });
  registerPromptsRoutes(app, { getPrompts: () => getPromptsLive(), setPrompts: (next: Prompt[]) => { promptsRepo.setAll(next); }, getSettings: () => getSettingsLive(), getAgents: () => getAgentsLive(), getDirectors: () => getDirectorsLive() });
  registerTemplatesRoutes(app);
  registerConversationsRoutes(app, { getConversations: () => getConversationsLive(), setConversations: (next: ConversationThread[]) => { conversationsRepo.setAll(next); conversations = conversationsRepo.getAll(); }, getSettings: () => getSettingsLive(), isDirectorFinalized, logProviderEvent: (e: ProviderEvent) => { svcLogProviderEvent(e); }, newId, getDirectors: () => getDirectorsLive(), getAgents: () => getAgentsLive() });
  registerWorkspacesRoutes(app, { getConversations: () => getConversationsLive(), setConversations: (next: ConversationThread[]) => { conversationsRepo.setAll(next); conversations = conversationsRepo.getAll(); }, workspaceRepo });
  registerImprintsRoutes(app, { getImprints: () => getImprintsLive(), setImprints: (next: Imprint[]) => { imprintsRepo.setAll(next); } });
  registerAccountsRoutes(app);
  registerDiagnosticsRoutes(app, { getOrchestrationLog: () => orchRepo.getAll(), getConversations: () => getConversationsLive() });
  registerDiagnosticTracesRoutes(app, { getTraces: () => tracesRepo.getAll(), setTraces: (next) => { tracesRepo.setAll(next); } });
  registerUnifiedDiagnosticsRoutes(app, { 
    getOrchestrationLog: () => orchRepo.getAll(), 
    getConversations: () => getConversationsLive(),
    getProviderEvents: () => providerRepo.getAll(),
    getTraces: () => tracesRepo.getAll()
  });
  registerHealthRoutes(app);

  const fetcher = initFetcher({
    getSettings: () => getSettingsLive(),
    getFilters: () => getFiltersLive(),
    getDirectors: () => getDirectorsLive(),
    getAgents: () => getAgentsLive(),
    getPrompts: () => getPromptsLive(),
    getConversations: () => getConversationsLive(),
    setConversations: (next: ConversationThread[]) => { conversationsRepo.setAll(next); conversations = conversationsRepo.getAll(); },
    logOrch: (e: OrchestrationDiagnosticEntry) => { svcLogOrch(e); },
    logProviderEvent: (e: ProviderEvent) => { svcLogProviderEvent(e); },
    isDirectorFinalized,
  });

  registerFetcherRoutes(app, { getStatus: () => fetcher.getStatus(), startFetcherLoop: () => fetcher.startFetcherLoop(), stopFetcherLoop: () => fetcher.stopFetcherLoop(), fetchEmails: () => fetcher.fetchEmails(), getSettings: () => getSettingsLive(), getFetcherLog: () => fetcher.getFetcherLog(), setFetcherLog: (next) => fetcher.setFetcherLog(next) });
  registerCleanupRoutes(app, { 
    getFetcherLog: () => fetcher.getFetcherLog(), 
    setFetcherLog: (next) => fetcher.setFetcherLog(next),
    getOrchestrationLog: () => orchRepo.getAll(),
    setOrchestrationLog: (next) => orchRepo.setAll(next),
    getConversations: () => getConversationsLive(),
    setConversations: (next) => { conversationsRepo.setAll(next); conversations = conversationsRepo.getAll(); },
    getProviderEvents: () => providerRepo.getAll(),
    setProviderEvents: (next) => providerRepo.setAll(next),
    getTraces: () => tracesRepo.getAll(),
    setTraces: (next) => tracesRepo.setAll(next),
  });

  if (getSettingsLive().fetcherAutoStart !== false) { fetcher.startFetcherLoop(); }

  return app;
}
