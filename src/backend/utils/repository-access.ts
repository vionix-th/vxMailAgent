import { UserRequest, hasUserContext, getUserContext } from '../middleware/user-context';
import { Repository } from '../repository/core';
import { 
  Prompt, 
  Agent, 
  Director, 
  Filter, 
  Imprint, 
  ConversationThread, 
  OrchestrationDiagnosticEntry,
  Trace
} from '../../shared/types';

/**
 * Generic repository access utility that enforces user context requirements.
 * Eliminates duplicate getter/setter patterns across the codebase.
 */
export class RepositoryAccessor {
  /**
   * Get all items from a repository with user context validation.
   */
  static getAll<T>(
    req: UserRequest | undefined, 
    repoKey: keyof ReturnType<typeof getUserContext>['repos'],
    entityName: string
  ): T[] {
    if (req && hasUserContext(req)) {
      const repo = getUserContext(req).repos[repoKey] as Repository<T>;
      return repo.getAll();
    }
    throw new Error(`User context required - no global ${entityName} available`);
  }

  /**
   * Set all items in a repository with user context validation.
   */
  static setAll<T>(
    req: UserRequest, 
    repoKey: keyof ReturnType<typeof getUserContext>['repos'],
    items: T[],
    entityName: string
  ): void {
    if (hasUserContext(req)) {
      const repo = getUserContext(req).repos[repoKey] as Repository<T>;
      repo.setAll(items);
    } else {
      throw new Error(`User context required - no global ${entityName} available`);
    }
  }

  /**
   * Get first item from a repository (typically for settings).
   */
  static getFirst<T>(
    req: UserRequest | undefined, 
    repoKey: keyof ReturnType<typeof getUserContext>['repos'],
    entityName: string,
    defaultValue?: T
  ): T {
    if (!req || !hasUserContext(req)) {
      throw new Error(`User context required - no global ${entityName} available`);
    }
    const repo = getUserContext(req).repos[repoKey] as Repository<T>;
    const items = repo.getAll();
    return items[0] || defaultValue || ({} as T);
  }
}

/**
 * Typed repository accessors for common entities.
 * These provide type safety and consistent error messages.
 */
export const RepositoryAccessors = {
  prompts: {
    getAll: (req?: UserRequest): Prompt[] => 
      RepositoryAccessor.getAll<Prompt>(req, 'prompts', 'prompts'),
    setAll: (req: UserRequest, items: Prompt[]): void => 
      RepositoryAccessor.setAll<Prompt>(req, 'prompts', items, 'prompts')
  },

  agents: {
    getAll: (req?: UserRequest): Agent[] => 
      RepositoryAccessor.getAll<Agent>(req, 'agents', 'agents'),
    setAll: (req: UserRequest, items: Agent[]): void => 
      RepositoryAccessor.setAll<Agent>(req, 'agents', items, 'agents')
  },

  directors: {
    getAll: (req?: UserRequest): Director[] => 
      RepositoryAccessor.getAll<Director>(req, 'directors', 'directors'),
    setAll: (req: UserRequest, items: Director[]): void => 
      RepositoryAccessor.setAll<Director>(req, 'directors', items, 'directors')
  },

  filters: {
    getAll: (req?: UserRequest): Filter[] => 
      RepositoryAccessor.getAll<Filter>(req, 'filters', 'filters'),
    setAll: (req: UserRequest, items: Filter[]): void => 
      RepositoryAccessor.setAll<Filter>(req, 'filters', items, 'filters')
  },

  imprints: {
    getAll: (req?: UserRequest): Imprint[] => 
      RepositoryAccessor.getAll<Imprint>(req, 'imprints', 'imprints'),
    setAll: (req: UserRequest, items: Imprint[]): void => 
      RepositoryAccessor.setAll<Imprint>(req, 'imprints', items, 'imprints')
  },

  conversations: {
    getAll: (req?: UserRequest): ConversationThread[] => 
      RepositoryAccessor.getAll<ConversationThread>(req, 'conversations', 'conversations'),
    setAll: (req: UserRequest, items: ConversationThread[]): void => 
      RepositoryAccessor.setAll<ConversationThread>(req, 'conversations', items, 'conversations')
  },

  orchestrationLog: {
    getAll: (req?: UserRequest): OrchestrationDiagnosticEntry[] => 
      RepositoryAccessor.getAll<OrchestrationDiagnosticEntry>(req, 'orchestrationLog', 'orchestration log'),
  },

  settings: {
    get: (req?: UserRequest) => 
      RepositoryAccessor.getFirst(req, 'settings', 'settings', {})
  },

  traces: {
    getAll: (req?: UserRequest): Trace[] => 
      RepositoryAccessor.getAll<Trace>(req, 'traces', 'traces'),
    setAll: (req: UserRequest, items: Trace[]): void => 
      RepositoryAccessor.setAll<Trace>(req, 'traces', items, 'traces')
  }
};
