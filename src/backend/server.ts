import express from 'express';
import cors from 'cors';

import authRouter from './auth';
import { requireAuth } from './middleware/auth';
import { setOrchestrationLog as svcSetOrchestrationLog, logOrch as svcLogOrch, logProviderEvent as svcLogProviderEvent, getOrchestrationLog, getTraces } from './services/logging';

import { Filter, Director, Agent, Prompt, Imprint, OrchestrationDiagnosticEntry, ConversationThread, ProviderEvent, User, FetcherLogEntry } from '../shared/types';
import { USERS_FILE } from './utils/paths';
import { newId } from './utils/id';
import { createJsonRepository } from './repository/fileRepositories';
import { setUsersRepo, getUsersRepo } from './services/users';
import { repoBundleRegistry } from './repository/registry';
import registerAuthSessionRoutes from './routes/auth-session';

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
import registerCleanupRoutes from './routes/cleanup';
// Health and cleanup routes removed - user isolation enforced
// initFetcher removed - using FetcherManager
import { FetcherManager } from './services/fetcher-manager';
import { createToolHandler } from './toolCalls';
import { attachUserContext, UserRequest, hasUserContext, getUserContext } from './middleware/user-context';

/** Create and configure the backend Express server. */
export function createServer() {
  const app = express();

  function getPromptsLive(req?: UserRequest): Prompt[] { 
    if (req && hasUserContext(req)) {
      return getUserContext(req).repos.prompts.getAll();
    }
    throw new Error('User context required - no global prompts available');
  }

  function getAgentsLive(req?: UserRequest): Agent[] {
    if (req && hasUserContext(req)) {
      return getUserContext(req).repos.agents.getAll();
    }
    throw new Error('User context required - no global agents available');
  }
  function getDirectorsLive(req?: UserRequest): Director[] {
    if (req && hasUserContext(req)) {
      return getUserContext(req).repos.directors.getAll();
    }
    throw new Error('User context required - no global directors available');
  }
  function getFiltersLive(req?: UserRequest): Filter[] {
    if (req && hasUserContext(req)) {
      return getUserContext(req).repos.filters.getAll();
    }
    throw new Error('User context required - no global filters available');
  }
  function getImprintsLive(req?: UserRequest): Imprint[] {
    if (req && hasUserContext(req)) {
      return getUserContext(req).repos.imprints.getAll();
    }
    throw new Error('User context required - no global imprints available');
  }
  function getOrchestrationLogLive(req?: UserRequest): OrchestrationDiagnosticEntry[] { 
    if (req && hasUserContext(req)) {
      return getUserContext(req).repos.orchestrationLog.getAll();
    }
    throw new Error('User context required - no global orchestration log available');
  }
  function getConversationsLive(req?: UserRequest): ConversationThread[] {
    if (req && hasUserContext(req)) {
      return getUserContext(req).repos.conversations.getAll();
    }
    throw new Error('User context required - no global conversations available');
  }
  function getSettingsLive(req?: UserRequest) { 
    if (!req || !hasUserContext(req)) {
      throw new Error('User context required - no global settings available');
    }
    return getUserContext(req).repos.settings.getAll()[0] || {};
  }

  // Setter functions for per-user repositories
  function setPromptsLive(req: UserRequest, next: Prompt[]): void {
    if (hasUserContext(req)) {
      getUserContext(req).repos.prompts.setAll(next);
    } else {
      throw new Error('User context required - no global prompts available');
    }
  }

  function setAgentsLive(req: UserRequest, next: Agent[]): void {
    if (hasUserContext(req)) {
      getUserContext(req).repos.agents.setAll(next);
    } else {
      throw new Error('User context required - no global agents available');
    }
  }

  function setDirectorsLive(req: UserRequest, next: Director[]): void {
    if (hasUserContext(req)) {
      getUserContext(req).repos.directors.setAll(next);
    } else {
      throw new Error('User context required - no global directors available');
    }
  }

  function setFiltersLive(req: UserRequest, next: Filter[]): void {
    if (hasUserContext(req)) {
      getUserContext(req).repos.filters.setAll(next);
    } else {
      throw new Error('User context required - no global filters available');
    }
  }

  function setImprintsLive(req: UserRequest, next: Imprint[]): void {
    if (hasUserContext(req)) {
      getUserContext(req).repos.imprints.setAll(next);
    } else {
      throw new Error('User context required - no global imprints available');
    }
  }

  function setConversationsLive(req: UserRequest, next: ConversationThread[]) {
    if (hasUserContext(req)) {
      getUserContext(req).repos.conversations.setAll(next);
    } else {
      throw new Error('User context required - no global conversations available');
    }
  }

  function getProviderRepo(req?: UserRequest) {
    if (req && hasUserContext(req)) {
      return getUserContext(req).repos.providerEvents;
    }
    throw new Error('User context required - no global provider events available');
  }

  function getTracesRepo(req?: UserRequest) {
    if (req && hasUserContext(req)) {
      return getUserContext(req).repos.traces;
    }
    throw new Error('User context required - no global traces available');
  }

  // Director finalization removed - requires user context

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
  app.use((req, res, next) => { void res; console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`); next(); });
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

  app.use(requireAuth);
  app.use(attachUserContext);
  app.use('/api', authRouter);
  // System-level repositories: only users registry remains
  const usersRepo = createJsonRepository<User>(USERS_FILE);
  setUsersRepo(usersRepo);
  // Logging initialization removed - per-user logging only
  registerAuthSessionRoutes(app);
  registerTestRoutes(app, { 
    getPrompts: (req?: UserRequest) => getPromptsLive(req), 
    getDirectors: (req?: UserRequest) => getDirectorsLive(req), 
    getAgents: (req?: UserRequest) => getAgentsLive(req) 
  });
  registerMemoryRoutes(app, {});
  registerOrchestrationRoutes(app, { getOrchestrationLog: (req?: UserRequest) => getOrchestrationLogLive(req), setOrchestrationLog: (next: OrchestrationDiagnosticEntry[], req?: UserRequest) => { svcSetOrchestrationLog(next, req); }, getSettings: (req?: UserRequest) => getSettingsLive(req) });
  registerSettingsRoutes(app, { getSettings: (req?: UserRequest) => getSettingsLive(req) });
  registerAgentsRoutes(app, { 
    getAgents: (req?: UserRequest) => getAgentsLive(req), 
    setAgents: (req: UserRequest, next: Agent[]) => setAgentsLive(req, next) 
  });
  registerFiltersRoutes(app, { 
    getFilters: (req?: UserRequest) => getFiltersLive(req), 
    setFilters: (req: UserRequest, next: Filter[]) => setFiltersLive(req, next) 
  });
  registerDirectorsRoutes(app, { 
    getDirectors: (req?: UserRequest) => getDirectorsLive(req), 
    setDirectors: (req: UserRequest, next: Director[]) => setDirectorsLive(req, next) 
  });
  registerPromptsRoutes(app, { 
    getPrompts: (req?: UserRequest) => getPromptsLive(req), 
    setPrompts: (req: UserRequest, next: Prompt[]) => setPromptsLive(req, next), 
    getSettings: (req?: UserRequest) => getSettingsLive(req), 
    getAgents: (req?: UserRequest) => getAgentsLive(req), 
    getDirectors: (req?: UserRequest) => getDirectorsLive(req) 
  });
  registerTemplatesRoutes(app);
  registerConversationsRoutes(app, { 
    getConversations: (req?: UserRequest) => getConversationsLive(req), 
    setConversations: (req: UserRequest, next: ConversationThread[]) => setConversationsLive(req, next), 
    getSettings: (req?: UserRequest) => getSettingsLive(req), 
    logProviderEvent: (e: ProviderEvent, req?: UserRequest) => { svcLogProviderEvent(e, req); }, 
    newId, 
    getDirectors: (req?: UserRequest) => getDirectorsLive(req), 
    getAgents: (req?: UserRequest) => getAgentsLive(req) 
  });
  registerWorkspacesRoutes(app, { 
    getConversations: (req?: UserRequest) => getConversationsLive(req), 
    setConversations: (req: UserRequest, next: ConversationThread[]) => setConversationsLive(req, next)
  });
  registerImprintsRoutes(app, { 
    getImprints: (req?: UserRequest) => getImprintsLive(req), 
    setImprints: (req: UserRequest, next: Imprint[]) => setImprintsLive(req, next) 
  });
  registerAccountsRoutes(app);
  registerDiagnosticsRoutes(app, { getOrchestrationLog: (req?: UserRequest) => getOrchestrationLogLive(req), getConversations: (req?: UserRequest) => getConversationsLive(req) });
  registerDiagnosticTracesRoutes(app, { getTraces: (req?: UserRequest) => getTracesRepo(req).getAll(), setTraces: (req: UserRequest, next) => getTracesRepo(req).setAll(next) });
  registerUnifiedDiagnosticsRoutes(app, {
    getOrchestrationLog: (req?: UserRequest) => getOrchestrationLog(req),
    getConversations: (req?: UserRequest) => getConversationsLive(req),
    getProviderEvents: (req?: UserRequest) => getProviderRepo(req).getAll(),
    getTraces: (req?: UserRequest) => getTraces(req)
  });

  // Conversations routes registration moved to proper location (single registration only)

  // Initialize FetcherManager with per-user fetcher factory
  const fetcherManager = new FetcherManager((uid: string) => {
    // Get user repository bundle directly for background operations
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
        // Create mock request for logging service
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
    };
  });

  // Global fetcher initialization removed - user isolation enforced

  registerFetcherRoutes(app, {
    getStatus: (req: UserRequest) => fetcherManager.getStatus(req),
    startFetcherLoop: (req: UserRequest) => fetcherManager.startFetcherLoop(req),
    stopFetcherLoop: (req: UserRequest) => fetcherManager.stopFetcherLoop(req),
    fetchEmails: (req: UserRequest) => fetcherManager.fetchEmails(req),
    getSettings: (req: UserRequest) => getSettingsLive(req),
    getFetcherLog: (req: UserRequest) => fetcherManager.getFetcherLog(req),
    setFetcherLog: (req: UserRequest, next) => fetcherManager.setFetcherLog(req, next)
  });
  // Cleanup endpoints (per-user)
  registerCleanupRoutes(app);
  // Cleanup routes removed - user isolation enforced
  // All cleanup operations must use per-user repositories

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
          console.log(`[BOOT] Started fetcher loop for user ${uid}`);
          // Log to per-user fetcher log as well
          const cur: FetcherLogEntry[] = fetcherManager.getFetcherLog(mockReq) as any;
          const entry: FetcherLogEntry = { timestamp: new Date().toISOString(), level: 'info', event: 'boot_autostart', message: 'Fetcher loop auto-started on server boot' } as any;
          fetcherManager.setFetcherLog(mockReq, [...cur, entry] as any);
        } catch (e) {
          console.error(`[BOOT] Failed to start fetcher loop for user ${uid}:`, e);
          try {
            const cur: FetcherLogEntry[] = fetcherManager.getFetcherLog(mockReq) as any;
            const entry: FetcherLogEntry = { timestamp: new Date().toISOString(), level: 'error', event: 'boot_autostart_failed', message: 'Failed to auto-start fetcher loop on server boot', detail: String((e as any)?.message || e) } as any;
            fetcherManager.setFetcherLog(mockReq, [...cur, entry] as any);
          } catch {}
        }
      }
    }
  } catch (e) {
    console.error('[BOOT] Fetcher bootstrap failed:', e);
  }

  return app;
}
