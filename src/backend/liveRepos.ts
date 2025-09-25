import { Filter, Director, Agent, Prompt, Imprint, OrchestrationEvent, ConversationThread, PromptMessage, EmailEnvelope, ProviderEvent, WorkspaceItem } from '../shared/types';
import { createAccount } from '../shared/constructors';
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
  setImprints(req: ReqLike, next: Imprint[]): Promise<void>;
  getOrchestrationLog(req?: ReqLike): Promise<OrchestrationEvent[]>;
  getConversations(req?: ReqLike): Promise<ConversationThread[]>;
  setConversations(req: ReqLike, next: ConversationThread[]): Promise<void>;
  appendConversation(req: ReqLike, thread: ConversationThread): Promise<ConversationThread>;
  /** Append one or more messages to a thread atomically. */
  appendMessagesToConversation(req: ReqLike, threadId: string, messages: any[]): Promise<ConversationThread | null>;
  /** Finalize a thread's status atomically. */
  finalizeThreadStatusAtomic(req: ReqLike, threadId: string, status: 'completed' | 'failed'): Promise<ConversationThread | null>;
  getEmails(req?: ReqLike): Promise<EmailEnvelope[]>;
  setEmails(req: ReqLike, next: EmailEnvelope[]): Promise<void>;
  getProviderEvents(req?: ReqLike): Promise<ProviderEvent[]>;
  getProviderEventsByConversation(req: ReqLike, conversationId: string): Promise<ProviderEvent[]>;
  getConversationById(req: ReqLike, id: string): Promise<ConversationThread | null>;
  getOrchestrationLogByConversation(req: ReqLike, conversationId: string): Promise<OrchestrationEvent[]>;
  getWorkspaceItemsByConversation(req: ReqLike, conversationId: string): Promise<WorkspaceItem[]>;
  getSettings(req?: ReqLike): Promise<any>;
  getProviderRepo(req?: ReqLike): any;
  getTracesRepo(req?: ReqLike): any;
  getAccounts(req?: ReqLike): Promise<any[]>;
  setAccounts(req: ReqLike, next: any[]): Promise<void>;
  getFetcherLog(req?: ReqLike): Promise<any[]>;
  setFetcherLog(req: ReqLike, next: any[]): Promise<void>;
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
  const set = <T>(fn: (req: ReqLike) => { setAll: (next: T[]) => Promise<void> }) => async (
    req: ReqLike,
    next: T[]
  ) => {
    const repo = fn(requireReq(req));
    await repo.setAll(next);
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
    setImprints: set<Imprint>((req) => getImprintsRepo(req)),
    getOrchestrationLog: get<OrchestrationEvent>((req) => getOrchestrationLogRepo(req)),
    getConversations: get<ConversationThread>((req) => getConversationsRepo(req)),
    setConversations: async (req: ReqLike, next: ConversationThread[]) => {
      const repo = requireConversationRepo(req);
      const existing = await repo.list();
      const existingById = new Map(existing.map((thread) => [thread.id, thread] as const));
      const nextIds = new Set<string>();

      for (const thread of next) {
        ensureTimestamps(thread, 'setConversations');
        nextIds.add(thread.id);
        if (existingById.has(thread.id)) {
          await repo.update(thread);
        } else {
          await repo.insert(thread);
        }
      }

      for (const thread of existing) {
        if (!nextIds.has(thread.id)) {
          await repo.delete(thread.id);
        }
      }
    },
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
    setAccounts: async (req: ReqLike, next: any[]) => {
      const repo = getAccountsRepo(requireReq(req));
      const incoming = Array.isArray(next) ? next : [];
      const existing = await repo.list();
      const existingIds = new Set(existing.map((acc) => acc.id));

      for (const raw of incoming) {
        const account = createAccount(raw as any);
        if (existingIds.has(account.id)) {
          await repo.update(account);
          existingIds.delete(account.id);
        } else {
          await repo.insert(account);
        }
      }

      for (const leftover of existingIds) {
        await repo.delete(leftover);
      }
    },
    getFetcherLog: async (req?: ReqLike) => {
      const repo = getFetcherLogRepo(requireReq(req));
      return await repo.getAll();
    },
    setFetcherLog: async (req: ReqLike, next: any[]) => {
      const repo = getFetcherLogRepo(requireReq(req));
      await repo.setAll(next);
    },
    getEmails: get<EmailEnvelope>((req) => getEmailsRepo(req)),
    setEmails: set<EmailEnvelope>((req) => getEmailsRepo(req)),
    getProviderEvents: async (req?: ReqLike) => {
      const repo = getProviderEventsRepo(requireReq(req));
      return await repo.getAll();
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
