import { Account, Filter, Director, Agent, Prompt, Imprint, OrchestrationEvent, ConversationThread, PromptMessage, EmailEnvelope, ProviderEvent, WorkspaceItem, FetcherLogEntry } from '../shared/types';
import {
  ensureContext,
  requireRepos,
  getPromptsRepo,
  getAgentsRepo,
  getDirectorsRepo,
  getFiltersRepo,
  getImprintsRepo,
  getAccountsRepo,
  getFetcherLogRepo,
  getProviderEventsRepo,
  getTracesRepo as resolveTracesRepo,
  getOrchestrationLogRepo,
  getConversationsRepo,
  getWorkspaceItemsRepo,
  getEmailsRepo,
  ContextInput,
  UserScopedContext
} from './utils/repo-access';
import { loadSettings } from './services/settings';
import { ValidationError, NotFoundError } from './services/error-handler';
import { validateFetcherLogEntry, validateFetcherLogEntries } from './services/fetcher-log-validation';
import { assertThreadTimestamps } from './services/conversation-mutations';

const requireArrayInput = <T>(value: unknown, label: string): readonly T[] => {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${label} must be an array`, 'LIVE_REPO_ARRAY_REQUIRED');
  }
  return value as readonly T[];
};
export interface LiveRepos {
  getPrompts(context?: ContextInput): Promise<Prompt[]>;
  getAgents(context?: ContextInput): Promise<Agent[]>;
  getDirectors(context?: ContextInput): Promise<Director[]>;
  getFilters(context?: ContextInput): Promise<Filter[]>;
  getImprints(context?: ContextInput): Promise<Imprint[]>;
  insertImprint(context: ContextInput, imprint: Imprint): Promise<void>;
  updateImprint(context: ContextInput, imprint: Imprint): Promise<void>;
  deleteImprint(context: ContextInput, id: string): Promise<boolean>;
  getOrchestrationLog(context?: ContextInput): Promise<OrchestrationEvent[]>;
  getConversations(context?: ContextInput): Promise<ConversationThread[]>;
  findOngoingAgentThread(context: ContextInput, parentId: string, agentId: string): Promise<ConversationThread | null>;
  appendConversation(context: ContextInput, thread: ConversationThread): Promise<ConversationThread>;
  updateConversation(context: ContextInput, thread: ConversationThread): Promise<ConversationThread>;
  deleteConversation(context: ContextInput, id: string): Promise<boolean>;
  /** Append one or more messages to a thread atomically. */
  appendMessagesToConversation(context: ContextInput, threadId: string, messages: any[]): Promise<ConversationThread>;
  /** Finalize a thread's status atomically. */
  finalizeThreadStatusAtomic(context: ContextInput, threadId: string, status: 'completed' | 'failed'): Promise<ConversationThread | null>;
  getEmails(context?: ContextInput): Promise<EmailEnvelope[]>;
  getEmailsPage(context: ContextInput, params: { offset: number; limit: number; totalHint?: number }): Promise<{ total: number; items: EmailEnvelope[] }>;
  upsertEmails(context: ContextInput, next: EmailEnvelope[]): Promise<void>;
  deleteEmail(context: ContextInput, id: string): Promise<boolean>;
  clearEmails(context: ContextInput): Promise<void>;
  getProviderEvents(context?: ContextInput): Promise<ProviderEvent[]>;
  getProviderEventsByConversation(context: ContextInput, conversationId: string): Promise<ProviderEvent[]>;
  getProviderEventsByConversationIds(context: ContextInput, conversationIds: readonly string[]): Promise<ProviderEvent[]>;
  getConversationById(context: ContextInput, id: string): Promise<ConversationThread | null>;
  getConversationsByEmailIds(context: ContextInput, emailIds: readonly string[]): Promise<ConversationThread[]>;
  getOrchestrationLogByConversation(context: ContextInput, conversationId: string): Promise<OrchestrationEvent[]>;
  getOrchestrationLogByConversationIds(context: ContextInput, conversationIds: readonly string[]): Promise<OrchestrationEvent[]>;
  getWorkspaceItemsByConversation(context: ContextInput, conversationId: string): Promise<WorkspaceItem[]>;
  getSettings(context?: ContextInput): Promise<any>;
  getProviderRepo(context?: ContextInput): any;
  getTracesRepo(context?: ContextInput): any;
  getAccounts(context?: ContextInput): Promise<any[]>;
  updateAccountTokens(context: ContextInput, id: string, tokens: Account['tokens']): Promise<Account>;
  getFetcherLog(context?: ContextInput): Promise<any[]>;
  appendFetcherLog(context: ContextInput, entry: FetcherLogEntry): Promise<void>;
  replaceFetcherLog(context: ContextInput, next: FetcherLogEntry[]): Promise<void>;
  clearFetcherLog(context: ContextInput): Promise<void>;
  deleteFetcherLog(context: ContextInput, id: string): Promise<boolean>;
  deleteFetcherLogs(context: ContextInput, ids: readonly string[]): Promise<number>;
}

export function createLiveRepos(): LiveRepos {
  const get = <T>(fn: (ctx: UserScopedContext) => any) => async (context?: ContextInput): Promise<T[]> => {
    const scoped = ensureContext(context);
    const repo = fn(scoped);
    if (typeof repo.list === 'function') {
      const items = await repo.list();
      return Array.isArray(items) ? items.slice() : Array.from(items);
    }
    if (typeof repo.getAll === 'function') {
      return await repo.getAll();
    }
    throw new Error('LiveRepos: repository does not support list/getAll');
  };
  const requireConversationRepo = (context: ContextInput) => {
    const scoped = ensureContext(context);
    const bundle = requireRepos(scoped);
    const repo = bundle.conversations;
    if (
      !repo ||
      typeof repo.list !== 'function' ||
      typeof repo.getById !== 'function' ||
      typeof repo.findOngoingAgentThread !== 'function' ||
      typeof repo.insert !== 'function' ||
      typeof repo.update !== 'function' ||
      typeof repo.appendMessages !== 'function' ||
      typeof repo.finalizeStatus !== 'function' ||
      typeof repo.delete !== 'function'
    ) {
      throw new Error('Conversations repository must implement typed contract');
    }
    return repo;
  };

  return {
    getPrompts: get<Prompt>((ctx) => getPromptsRepo(ctx)),
    getAgents: get<Agent>((ctx) => getAgentsRepo(ctx)),
    getDirectors: get<Director>((ctx) => getDirectorsRepo(ctx)),
    getFilters: get<Filter>((ctx) => getFiltersRepo(ctx)),
    getImprints: get<Imprint>((ctx) => getImprintsRepo(ctx)),
    insertImprint: async (context: ContextInput, imprint: Imprint) => {
      const repo = getImprintsRepo(ensureContext(context));
      await repo.insert(imprint);
    },
    updateImprint: async (context: ContextInput, imprint: Imprint) => {
      const repo = getImprintsRepo(ensureContext(context));
      await repo.update(imprint);
    },
    deleteImprint: async (context: ContextInput, id: string) => {
      const repo = getImprintsRepo(ensureContext(context));
      return await repo.delete(id);
    },
    getOrchestrationLog: get<OrchestrationEvent>((ctx) => getOrchestrationLogRepo(ctx)),
    getConversations: get<ConversationThread>((ctx) => getConversationsRepo(ctx)),
    findOngoingAgentThread: async (context: ContextInput, parentId: string, agentId: string): Promise<ConversationThread | null> => {
      const repo = getConversationsRepo(ensureContext(context));
      return await repo.findOngoingAgentThread(parentId, agentId);
    },
    appendConversation: async (context: ContextInput, thread: ConversationThread): Promise<ConversationThread> => {
      assertThreadTimestamps(thread, 'appendConversation');
      const repo = requireConversationRepo(context);
      await repo.insert(thread);
      const appended = await repo.getById(thread.id);
      if (!appended) {
        throw new Error(`Failed to append conversation thread: ${thread.id}`);
      }
      return appended;
    },
    updateConversation: async (context: ContextInput, thread: ConversationThread): Promise<ConversationThread> => {
      assertThreadTimestamps(thread, 'updateConversation');
      const repo = requireConversationRepo(context);
      await repo.update(thread);
      const updated = await repo.getById(thread.id);
      if (!updated) {
        throw new Error(`Failed to reload updated conversation thread: ${thread.id}`);
      }
      return updated;
    },
    deleteConversation: async (context: ContextInput, id: string): Promise<boolean> => {
      const repo = requireConversationRepo(context);
      return await repo.delete(id);
    },
    appendMessagesToConversation: async (context: ContextInput, threadId: string, messages: any[]): Promise<ConversationThread> => {
      if (!Array.isArray(messages) || messages.length === 0) {
        throw new ValidationError('appendMessagesToConversation requires non-empty messages array', 'CONVERSATION_APPEND_EMPTY');
      }
      const repo = requireConversationRepo(context);
      try {
        const updated = await repo.appendMessages(threadId, messages as PromptMessage[]);
        assertThreadTimestamps(updated, 'appendMessagesToConversation');
        return updated;
      } catch (error: any) {
        if (error && typeof error.message === 'string' && error.message.includes('not found')) {
          throw new NotFoundError(`Conversation ${threadId} not found during append`, 'CONVERSATION_NOT_FOUND');
        }
        throw error;
      }
    },
    finalizeThreadStatusAtomic: async (context: ContextInput, threadId: string, status: 'completed' | 'failed'): Promise<ConversationThread | null> => {
      const repo = requireConversationRepo(context);
      return await repo.finalizeStatus(threadId, status, new Date().toISOString());
    },
    getSettings: async (context?: ContextInput) => {
      const scoped = ensureContext(context);
      return await loadSettings(scoped);
    },
    getProviderRepo: (context?: ContextInput) => getProviderEventsRepo(ensureContext(context)),
    getTracesRepo: (context?: ContextInput) => resolveTracesRepo(ensureContext(context)),
    getAccounts: async (context?: ContextInput) => {
      const repo = getAccountsRepo(ensureContext(context));
      const rows = await repo.list();
      return [...rows];
    },
    updateAccountTokens: async (context: ContextInput, id: string, tokens: Account['tokens']) => {
      const repo = getAccountsRepo(ensureContext(context));
      return await repo.updateTokens(id, tokens);
    },
    getFetcherLog: async (context?: ContextInput) => {
      const repo = getFetcherLogRepo(ensureContext(context));
      return await repo.list();
    },
    appendFetcherLog: async (context: ContextInput, entry: FetcherLogEntry) => {
      const repo = getFetcherLogRepo(ensureContext(context));
      const validated = validateFetcherLogEntry(entry, 'fetcherLog');
      await repo.append(validated);
    },
    replaceFetcherLog: async (context: ContextInput, next: FetcherLogEntry[]) => {
      const repo = getFetcherLogRepo(ensureContext(context));
      const validated = validateFetcherLogEntries(next, 'fetcherLog');
      await repo.replace(validated);
    },
    clearFetcherLog: async (context: ContextInput) => {
      const repo = getFetcherLogRepo(ensureContext(context));
      await repo.clear();
    },
    deleteFetcherLog: async (context: ContextInput, id: string) => {
      const repo = getFetcherLogRepo(ensureContext(context));
      return await repo.delete(id);
    },
    deleteFetcherLogs: async (context: ContextInput, ids: readonly string[]) => {
      const repo = getFetcherLogRepo(ensureContext(context));
      return await repo.deleteMany(ids);
    },
    getEmails: get<EmailEnvelope>((ctx) => getEmailsRepo(ctx)),
    getEmailsPage: async (context: ContextInput, params: { offset: number; limit: number; totalHint?: number }) => {
      const scoped = ensureContext(context);
      const repo = getEmailsRepo(scoped);
      const total = typeof params.totalHint === 'number' ? params.totalHint : await repo.count();
      const items = await repo.listPage(Math.max(0, params.offset), Math.max(0, params.limit));
      return {
        total,
        items: Array.isArray(items) ? items.slice() : Array.from(items),
      };
    },
    upsertEmails: async (context: ContextInput, next: EmailEnvelope[]) => {
      const repo = getEmailsRepo(ensureContext(context));
      const envelopes = requireArrayInput<EmailEnvelope>(next, 'LiveRepos.upsertEmails');
      await repo.upsertMany(envelopes);
    },
    deleteEmail: async (context: ContextInput, id: string) => {
      const repo = getEmailsRepo(ensureContext(context));
      return await repo.delete(id);
    },
    clearEmails: async (context: ContextInput) => {
      const repo = getEmailsRepo(ensureContext(context));
      await repo.clear();
    },
    getProviderEvents: async (context?: ContextInput) => {
      const repo = getProviderEventsRepo(ensureContext(context));
      return await repo.list();
    },
    getProviderEventsByConversation: async (context: ContextInput, conversationId: string) => {
      const repo = getProviderEventsRepo(ensureContext(context));
      return await repo.getByConversation(conversationId);
    },
    getProviderEventsByConversationIds: async (context: ContextInput, conversationIds: readonly string[]) => {
      const repo = getProviderEventsRepo(ensureContext(context));
      const ids = requireArrayInput<string>(conversationIds, 'LiveRepos.getProviderEventsByConversationIds');
      return await repo.getByConversationIds(ids);
    },
    getConversationById: async (context: ContextInput, id: string) => {
      const repo = getConversationsRepo(ensureContext(context));
      return await repo.getById(id);
    },
    getConversationsByEmailIds: async (context: ContextInput, emailIds: readonly string[]) => {
      const repo = getConversationsRepo(ensureContext(context));
      const ids = requireArrayInput<string>(emailIds, 'LiveRepos.getConversationsByEmailIds');
      return await repo.listByEmailIds(ids);
    },
    getOrchestrationLogByConversation: async (context: ContextInput, conversationId: string) => {
      const repo = getOrchestrationLogRepo(ensureContext(context));
      return await repo.getByConversation(conversationId);
    },
    getOrchestrationLogByConversationIds: async (context: ContextInput, conversationIds: readonly string[]) => {
      const repo = getOrchestrationLogRepo(ensureContext(context));
      const ids = requireArrayInput<string>(conversationIds, 'LiveRepos.getOrchestrationLogByConversationIds');
      return await repo.getByConversationIds(ids);
    },
    getWorkspaceItemsByConversation: async (context: ContextInput, conversationId: string) => {
      const repo = getWorkspaceItemsRepo(ensureContext(context));
      const items = await repo.listByConversation(conversationId);
      return Array.isArray(items) ? items.slice() : Array.from(items);
    },
  };
}
