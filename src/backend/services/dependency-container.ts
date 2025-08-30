import { UserRequest } from '../middleware/user-context';
import { RepositoryAccessors } from '../utils/repository-access';
import { 
  setOrchestrationLog as svcSetOrchestrationLog, 
  logProviderEvent as svcLogProviderEvent
} from './logging';
import { newId } from '../utils/id';
import { 
  OrchestrationDiagnosticEntry,
  ProviderEvent,
  Trace
} from '../../shared/types';

/**
 * Centralized dependency container that eliminates repetitive dependency injection
 * patterns across route registrations.
 */
export class DependencyContainer {
  /**
   * Get standardized dependencies for entity CRUD routes.
   */
  static getEntityDependencies() {
    return {
      prompts: {
        getAll: RepositoryAccessors.prompts.getAll,
        setAll: RepositoryAccessors.prompts.setAll
      },
      agents: {
        getAll: RepositoryAccessors.agents.getAll,
        setAll: RepositoryAccessors.agents.setAll
      },
      directors: {
        getAll: RepositoryAccessors.directors.getAll,
        setAll: RepositoryAccessors.directors.setAll
      },
      filters: {
        getAll: RepositoryAccessors.filters.getAll,
        setAll: RepositoryAccessors.filters.setAll
      },
      imprints: {
        getAll: RepositoryAccessors.imprints.getAll,
        setAll: RepositoryAccessors.imprints.setAll
      },
      conversations: {
        getAll: RepositoryAccessors.conversations.getAll,
        setAll: RepositoryAccessors.conversations.setAll
      },
      settings: {
        get: RepositoryAccessors.settings.get
      }
    };
  }

  /**
   * Get dependencies for orchestration routes.
   */
  static getOrchestrationDependencies() {
    return {
      getOrchestrationLog: (req?: UserRequest) => RepositoryAccessors.orchestrationLog.getAll(req),
      setOrchestrationLog: (next: OrchestrationDiagnosticEntry[], req?: UserRequest) => {
        svcSetOrchestrationLog(next, req);
      },
      getSettings: RepositoryAccessors.settings.get
    };
  }

  /**
   * Get dependencies for conversation routes.
   */
  static getConversationDependencies() {
    return {
      getConversations: RepositoryAccessors.conversations.getAll,
      setConversations: RepositoryAccessors.conversations.setAll,
      getSettings: RepositoryAccessors.settings.get,
      logProviderEvent: (e: ProviderEvent, req?: UserRequest) => {
        svcLogProviderEvent(e, req);
      },
      newId,
      getDirectors: RepositoryAccessors.directors.getAll,
      getAgents: RepositoryAccessors.agents.getAll
    };
  }

  /**
   * Get dependencies for workspace routes.
   */
  static getWorkspaceDependencies() {
    return {
      getConversations: RepositoryAccessors.conversations.getAll,
      setConversations: RepositoryAccessors.conversations.setAll
    };
  }

  /**
   * Get dependencies for diagnostic routes.
   */
  static getDiagnosticDependencies() {
    return {
      getOrchestrationLog: (req?: UserRequest) => RepositoryAccessors.orchestrationLog.getAll(req),
      getConversations: RepositoryAccessors.conversations.getAll
    };
  }

  /**
   * Get dependencies for trace diagnostic routes.
   */
  static getTraceDependencies() {
    return {
      getTraces: (req?: UserRequest) => RepositoryAccessors.traces.getAll(req),
      setTraces: (req: UserRequest, next: Trace[]) => {
        // Access traces repository through user context
        const userContext = (req as any).userContext;
        if (userContext?.repos?.traces) {
          userContext.repos.traces.setAll(next);
        } else {
          throw new Error('User context required - no global traces available');
        }
      }
    };
  }

  /**
   * Get dependencies for unified diagnostic routes.
   */
  static getUnifiedDiagnosticDependencies() {
    return {
      getOrchestrationLog: (req?: UserRequest) => RepositoryAccessors.orchestrationLog.getAll(req),
      getConversations: RepositoryAccessors.conversations.getAll,
      getProviderEvents: (req?: UserRequest) => {
        const userContext = (req as any)?.userContext;
        if (userContext?.repos?.providerEvents) {
          return userContext.repos.providerEvents.getAll();
        }
        throw new Error('User context required - no global provider events available');
      },
      getTraces: (req?: UserRequest) => RepositoryAccessors.traces.getAll(req)
    };
  }

  /**
   * Get dependencies for test routes.
   */
  static getTestDependencies() {
    return {
      getPrompts: RepositoryAccessors.prompts.getAll,
      getDirectors: RepositoryAccessors.directors.getAll,
      getAgents: RepositoryAccessors.agents.getAll
    };
  }

  /**
   * Get all common dependencies in a single object.
   * Useful for routes that need multiple dependency types.
   */
  static getAllDependencies() {
    return {
      ...this.getEntityDependencies(),
      orchestration: this.getOrchestrationDependencies(),
      conversations: this.getConversationDependencies(),
      workspaces: this.getWorkspaceDependencies(),
      diagnostics: this.getDiagnosticDependencies(),
      traces: this.getTraceDependencies(),
      unified: this.getUnifiedDiagnosticDependencies(),
      test: this.getTestDependencies()
    };
  }
}
