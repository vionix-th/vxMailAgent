import { Account, Filter, Director, Agent, Prompt, Imprint, OrchestrationEvent, ConversationThread, PromptMessage, EmailEnvelope, ProviderEvent, WorkspaceItem, FetcherLogEntry } from '../shared/types';
import {
  requireReq,
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
  getEmailsRepo
} from './utils/repo-access';
import { loadSettings } from './services/settings';
import { ValidationError } from './services/error-handler';
import type { ReqLike } from './utils/repo-access';

export interface LiveRepos {
  getPrompts(req?: ReqLike): Promise<Prompt[]>;
  getAgents(req?: ReqLike): Promise<Agent[]>;
  getDirectors(req?: ReqLike): Promise<Director[]>;
  getFilters(req?: ReqLike): Promise<Filter[]>;
  getImprints(req?: ReqLike): Promise<Imprint[]>;
  insertImprint(req: ReqLike, imprint: Imprint): Promise<void>;
  updateImprint(req: ReqLike, imprint: Imprint): Promise<void>;
  deleteImprint(req: ReqLike, id: string): Promise<boolean>;
  getOrchestrationLog(req?: ReqLike): Promise<OrchestrationEvent[]>;
  getConversations(req?: ReqLike): Promise<ConversationThread[]>;
  appendConversation(req: ReqLike, thread: ConversationThread): Promise<ConversationThread>;
  updateConversation(req: ReqLike, thread: ConversationThread): Promise<ConversationThread>;
  deleteConversation(req: ReqLike, id: string): Promise<boolean>;
  /** Append one or more messages to a thread atomically. */
  appendMessagesToConversation(req: ReqLike, threadId: string, messages: any[]): Promise<ConversationThread | null>;
  /** Finalize a thread's status atomically. */
  finalizeThreadStatusAtomic(req: ReqLike, threadId: string, status: 'completed' | 'failed'): Promise<ConversationThread | null>;
  getEmails(req?: ReqLike): Promise<EmailEnvelope[]>;
  upsertEmails(req: ReqLike, next: EmailEnvelope[]): Promise<void>;
  deleteEmail(req: ReqLike, id: string): Promise<boolean>;
  clearEmails(req: ReqLike): Promise<void>;
  getProviderEvents(req?: ReqLike): Promise<ProviderEvent[]>;
  getProviderEventsByConversation(req: ReqLike, conversationId: string): Promise<ProviderEvent[]>;
  getConversationById(req: ReqLike, id: string): Promise<ConversationThread | null>;
  getOrchestrationLogByConversation(req: ReqLike, conversationId: string): Promise<OrchestrationEvent[]>;
  getWorkspaceItemsByConversation(req: ReqLike, conversationId: string): Promise<WorkspaceItem[]>;
  getSettings(req?: ReqLike): Promise<any>;
  getProviderRepo(req?: ReqLike): any;
  getTracesRepo(req?: ReqLike): any;
  getAccounts(req?: ReqLike): Promise<any[]>;
  updateAccountTokens(req: ReqLike, id: string, tokens: Account['tokens']): Promise<Account>;
  getFetcherLog(req?: ReqLike): Promise<any[]>;
  appendFetcherLog(req: ReqLike, entry: FetcherLogEntry): Promise<void>;
  replaceFetcherLog(req: ReqLike, next: FetcherLogEntry[]): Promise<void>;
  clearFetcherLog(req: ReqLike): Promise<void>;
  deleteFetcherLog(req: ReqLike, id: string): Promise<boolean>;
  deleteFetcherLogs(req: ReqLike, ids: readonly string[]): Promise<number>;
}

export function createLiveRepos(): LiveRepos {
  const ensureTimestamps = (thread: ConversationThread, context: string): void => {
    const { id, startedAt, lastActiveAt } = thread as ConversationThread & { startedAt?: string | null; lastActiveAt?: string | null };
    if (typeof startedAt !== 'string' || !startedAt.trim()) {
      throw new ValidationError(`${context}: startedAt missing for conversation ${id}`, 'CONVERSATION_STARTED_AT_MISSING');
    }
    if (typeof lastActiveAt !== 'string' || !lastActiveAt.trim()) {
      throw new ValidationError(`${context}: lastActiveAt missing for conversation ${id}`, 'CONVERSATION_LAST_ACTIVE_MISSING');
    }
    if (Number.isNaN(Date.parse(startedAt))) {
      throw new ValidationError(`${context}: startedAt invalid for conversation ${id}`, 'CONVERSATION_STARTED_AT_INVALID');
    }
    if (Number.isNaN(Date.parse(lastActiveAt))) {
      throw new ValidationError(`${context}: lastActiveAt invalid for conversation ${id}`, 'CONVERSATION_LAST_ACTIVE_INVALID');
    }
  };
  const get = <T>(fn: (req: ReqLike) => any) => async (req?: ReqLike): Promise<T[]> => {
    const repo = fn(requireReq(req));
    if (typeof repo.list === 'function') {
      const items = await repo.list();
      return Array.isArray(items) ? items.slice() : Array.from(items);
    }
    if (typeof repo.getAll === 'function') {
      return await repo.getAll();
    }
    throw new Error('LiveRepos: repository does not support list/getAll');
  };
  const requireConversationRepo = (req: ReqLike) => {
    const r = requireReq(req);
    const bundle = requireRepos(r);
    const repo = bundle.conversations;
    if (
      !repo ||
      typeof repo.list !== 'function' ||
      typeof repo.getById !== 'function' ||
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
    getPrompts: get<Prompt>((req) => getPromptsRepo(req)),
    getAgents: get<Agent>((req) => getAgentsRepo(req)),
    getDirectors: get<Director>((req) => getDirectorsRepo(req)),
    getFilters: get<Filter>((req) => getFiltersRepo(req)),
    getImprints: get<Imprint>((req) => getImprintsRepo(req)),
    insertImprint: async (req: ReqLike, imprint: Imprint) => {
      const repo = getImprintsRepo(requireReq(req));
      await repo.insert(imprint);
    },
    updateImprint: async (req: ReqLike, imprint: Imprint) => {
      const repo = getImprintsRepo(requireReq(req));
      await repo.update(imprint);
    },
    deleteImprint: async (req: ReqLike, id: string) => {
      const repo = getImprintsRepo(requireReq(req));
      return await repo.delete(id);
    },
    getOrchestrationLog: get<OrchestrationEvent>((req) => getOrchestrationLogRepo(req)),
    getConversations: get<ConversationThread>((req) => getConversationsRepo(req)),
    appendConversation: async (req: ReqLike, thread: ConversationThread): Promise<ConversationThread> => {
      ensureTimestamps(thread, 'appendConversation');
      const repo = requireConversationRepo(req);
      await repo.insert(thread);
      const appended = await repo.getById(thread.id);
      if (!appended) {
        throw new Error(`Failed to append conversation thread: ${thread.id}`);
      }
      return appended;
    },
    updateConversation: async (req: ReqLike, thread: ConversationThread): Promise<ConversationThread> => {
      ensureTimestamps(thread, 'updateConversation');
      const repo = requireConversationRepo(req);
      await repo.update(thread);
      const updated = await repo.getById(thread.id);
      if (!updated) {
        throw new Error(`Failed to reload updated conversation thread: ${thread.id}`);
      }
      return updated;
    },
    deleteConversation: async (req: ReqLike, id: string): Promise<boolean> => {
      const repo = requireConversationRepo(req);
      return await repo.delete(id);
    },
    appendMessagesToConversation: async (req: ReqLike, threadId: string, messages: any[]): Promise<ConversationThread | null> => {
      if (!Array.isArray(messages) || messages.length === 0) {
        throw new ValidationError('appendMessagesToConversation requires non-empty messages array', 'CONVERSATION_APPEND_EMPTY');
      }
      const repo = requireConversationRepo(req);
      const updated = await repo.appendMessages(threadId, messages as PromptMessage[]);
      return updated;
    },
    finalizeThreadStatusAtomic: async (req: ReqLike, threadId: string, status: 'completed' | 'failed'): Promise<ConversationThread | null> => {
      const repo = requireConversationRepo(req);
      return await repo.finalizeStatus(threadId, status, new Date().toISOString());
    },
    getSettings: async (req?: ReqLike) => {
      const r = requireReq(req);
      return await loadSettings(r);
    },
    getProviderRepo: (req?: ReqLike) => getProviderEventsRepo(requireReq(req)),
    getTracesRepo: (req?: ReqLike) => resolveTracesRepo(requireReq(req)),
    getAccounts: async (req?: ReqLike) => {
      const repo = getAccountsRepo(requireReq(req));
      const rows = await repo.list();
      return [...rows];
    },
    updateAccountTokens: async (req: ReqLike, id: string, tokens: Account['tokens']) => {
      const repo = getAccountsRepo(requireReq(req));
      return await repo.updateTokens(id, tokens);
    },
    getFetcherLog: async (req?: ReqLike) => {
      const repo = getFetcherLogRepo(requireReq(req));
      return await repo.list();
    },
    appendFetcherLog: async (req: ReqLike, entry: FetcherLogEntry) => {
      const repo = getFetcherLogRepo(requireReq(req));
      await repo.append(entry);
    },
    replaceFetcherLog: async (req: ReqLike, next: FetcherLogEntry[]) => {
      const repo = getFetcherLogRepo(requireReq(req));
      await repo.replace(Array.isArray(next) ? next : []);
    },
    clearFetcherLog: async (req: ReqLike) => {
      const repo = getFetcherLogRepo(requireReq(req));
      await repo.clear();
    },
    deleteFetcherLog: async (req: ReqLike, id: string) => {
      const repo = getFetcherLogRepo(requireReq(req));
      return await repo.delete(id);
    },
    deleteFetcherLogs: async (req: ReqLike, ids: readonly string[]) => {
      const repo = getFetcherLogRepo(requireReq(req));
      return await repo.deleteMany(ids);
    },
    getEmails: get<EmailEnvelope>((req) => getEmailsRepo(req)),
    upsertEmails: async (req: ReqLike, next: EmailEnvelope[]) => {
      const repo = getEmailsRepo(requireReq(req));
      await repo.upsertMany(Array.isArray(next) ? next : []);
    },
    deleteEmail: async (req: ReqLike, id: string) => {
      const repo = getEmailsRepo(requireReq(req));
      return await repo.delete(id);
    },
    clearEmails: async (req: ReqLike) => {
      const repo = getEmailsRepo(requireReq(req));
      await repo.clear();
    },
    getProviderEvents: async (req?: ReqLike) => {
      const repo = getProviderEventsRepo(requireReq(req));
      return await repo.list();
    },
    getProviderEventsByConversation: async (req: ReqLike, conversationId: string) => {
      const repo = getProviderEventsRepo(requireReq(req));
      return await repo.getByConversation(conversationId);
    },
    getConversationById: async (req: ReqLike, id: string) => {
      const repo = getConversationsRepo(requireReq(req));
      return await repo.getById(id);
    },
    getOrchestrationLogByConversation: async (req: ReqLike, conversationId: string) => {
      const repo = getOrchestrationLogRepo(requireReq(req));
      return await repo.getByConversation(conversationId);
    },
    getWorkspaceItemsByConversation: async (req: ReqLike, conversationId: string) => {
      const repo = getWorkspaceItemsRepo(requireReq(req));
      const items = await repo.listByConversation(conversationId);
      return Array.isArray(items) ? items.slice() : Array.from(items);
    },
  };
}
