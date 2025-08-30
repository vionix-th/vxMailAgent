import express from 'express';
import { requireAuth } from '../middleware/auth';
import { attachUserContext } from '../middleware/user-context';
import { DependencyContainer } from '../services/dependency-container';
import { RepositoryAccessors } from '../utils/repository-access';

// Route imports
import registerAuthSessionRoutes from '../routes/auth-session';
import registerTestRoutes from '../routes/test';
import registerMemoryRoutes from '../routes/memory';
import registerOrchestrationRoutes from '../routes/orchestration';
import registerSettingsRoutes from '../routes/settings';
import registerAgentsRoutes from '../routes/agents';
import registerFiltersRoutes from '../routes/filters';
import registerDirectorsRoutes from '../routes/directors';
import registerPromptsRoutes from '../routes/prompts';
import registerTemplatesRoutes from '../routes/templates';
import registerConversationsRoutes from '../routes/conversations';
import registerWorkspacesRoutes from '../routes/workspaces';
import registerImprintsRoutes from '../routes/imprints';
import registerAccountsRoutes from '../routes/accounts';
import registerFetcherRoutes from '../routes/fetcher';
import registerDiagnosticsRoutes from '../routes/diagnostics';
import registerDiagnosticTracesRoutes from '../routes/diagnostic-traces';
import registerUnifiedDiagnosticsRoutes from '../routes/unified-diagnostics';
import registerCleanupRoutes from '../routes/cleanup';

/**
 * Register all application routes with their dependencies.
 */
export function registerRoutes(app: express.Express, fetcherManager: any): void {
  // Authentication and user context middleware
  app.use(requireAuth);
  app.use(attachUserContext);

  // Route registration with centralized dependencies
  registerAuthSessionRoutes(app);
  registerTestRoutes(app, DependencyContainer.getTestDependencies());
  registerMemoryRoutes(app, {});
  registerOrchestrationRoutes(app, DependencyContainer.getOrchestrationDependencies());
  registerSettingsRoutes(app, { getSettings: RepositoryAccessors.settings.get });
  
  registerAgentsRoutes(app, {
    getAgents: RepositoryAccessors.agents.getAll,
    setAgents: RepositoryAccessors.agents.setAll
  });
  
  registerFiltersRoutes(app, {
    getFilters: RepositoryAccessors.filters.getAll,
    setFilters: RepositoryAccessors.filters.setAll
  });
  
  registerDirectorsRoutes(app, {
    getDirectors: RepositoryAccessors.directors.getAll,
    setDirectors: RepositoryAccessors.directors.setAll
  });
  
  registerPromptsRoutes(app, {
    getPrompts: RepositoryAccessors.prompts.getAll,
    setPrompts: RepositoryAccessors.prompts.setAll,
    getSettings: RepositoryAccessors.settings.get,
    getAgents: RepositoryAccessors.agents.getAll,
    getDirectors: RepositoryAccessors.directors.getAll
  });
  
  registerTemplatesRoutes(app);
  registerConversationsRoutes(app, DependencyContainer.getConversationDependencies());
  registerWorkspacesRoutes(app, DependencyContainer.getWorkspaceDependencies());
  
  registerImprintsRoutes(app, {
    getImprints: RepositoryAccessors.imprints.getAll,
    setImprints: RepositoryAccessors.imprints.setAll
  });
  
  registerAccountsRoutes(app);
  registerDiagnosticsRoutes(app, DependencyContainer.getDiagnosticDependencies());
  registerDiagnosticTracesRoutes(app, DependencyContainer.getTraceDependencies());
  registerUnifiedDiagnosticsRoutes(app, DependencyContainer.getUnifiedDiagnosticDependencies());

  // Fetcher routes with manager dependencies
  registerFetcherRoutes(app, {
    getStatus: (req: any) => fetcherManager.getStatus(req),
    startFetcherLoop: (req: any) => fetcherManager.startFetcherLoop(req),
    stopFetcherLoop: (req: any) => fetcherManager.stopFetcherLoop(req),
    fetchEmails: (req: any) => fetcherManager.fetchEmails(req),
    getSettings: RepositoryAccessors.settings.get,
    getFetcherLog: (req: any) => fetcherManager.getFetcherLog(req),
    setFetcherLog: (req: any, next: any) => fetcherManager.setFetcherLog(req, next)
  });

  // Cleanup routes
  registerCleanupRoutes(app);
}
