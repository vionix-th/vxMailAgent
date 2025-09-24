import { Filter, Director, Agent, Prompt, Imprint, OrchestrationEvent, ConversationThread, EmailEnvelope, ProviderEvent, WorkspaceItem } from '../shared/types';
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
  setPrompts(req: ReqLike, next: Prompt[]): Promise<void>;
  getAgents(req?: ReqLike): Promise<Agent[]>;
  setAgents(req: ReqLike, next: Agent[]): Promise<void>;
  getDirectors(req?: ReqLike): Promise<Director[]>;
  setDirectors(req: ReqLike, next: Director[]): Promise<void>;
  getFilters(req?: ReqLike): Promise<Filter[]>;
  setFilters(req: ReqLike, next: Filter[]): Promise<void>;
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
  const get = <T>(fn: (req: ReqLike) => { getAll: () => Promise<T[]> }) => async (req?: ReqLike) => {
    const repo = fn(requireReq(req));
    return await repo.getAll();
  };
  const set = <T>(fn: (req: ReqLike) => { setAll: (next: T[]) => Promise<void> }) => async (
    req: ReqLike,
    next: T[]
  ) => {
    const repo = fn(requireReq(req));
    await repo.setAll(next);
  };
  type ConversationRepoWithMutate = {
    mutate: (
      fn: (cur: ConversationThread[]) => Promise<ConversationThread[]> | ConversationThread[]
    ) => Promise<ConversationThread[]>;
  };
  const requireConversationRepo = (req: ReqLike): ConversationRepoWithMutate => {
    const r = requireReq(req);
    const bundle = requireRepos(r);
    const repo = bundle.conversations as unknown as ConversationRepoWithMutate | undefined;
    if (!repo || typeof repo.mutate !== 'function') {
      throw new Error('Conversations repository must support atomic mutate');
    }
    return repo;
  };

  return {
    getPrompts: get<Prompt>((req) => getPromptsRepo(req)),
    setPrompts: set<Prompt>((req) => getPromptsRepo(req)),
    getAgents: get<Agent>((req) => getAgentsRepo(req)),
    setAgents: set<Agent>((req) => getAgentsRepo(req)),
    getDirectors: get<Director>((req) => getDirectorsRepo(req)),
    setDirectors: set<Director>((req) => getDirectorsRepo(req)),
    getFilters: get<Filter>((req) => getFiltersRepo(req)),
    setFilters: set<Filter>((req) => getFiltersRepo(req)),
    getImprints: get<Imprint>((req) => getImprintsRepo(req)),
    setImprints: set<Imprint>((req) => getImprintsRepo(req)),
    getOrchestrationLog: get<OrchestrationEvent>((req) => getOrchestrationLogRepo(req)),
    getConversations: get<ConversationThread>((req) => getConversationsRepo(req)),
    setConversations: set<ConversationThread>((req) => getConversationsRepo(req)),
    appendConversation: async (req: ReqLike, thread: ConversationThread): Promise<ConversationThread> => {
      ensureTimestamps(thread, 'appendConversation');
      const repo = requireConversationRepo(req);
      const next = await repo.mutate((cur) => {
        const snapshot = Array.isArray(cur) ? cur : [];
        if (snapshot.some((c) => c.id === thread.id)) {
          throw new Error(`Conversation thread already exists: ${thread.id}`);
        }
        return [...snapshot, thread];
      });
      const appended = next.find((c) => c.id === thread.id);
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
      const next = await repo.mutate((cur) => {
        const idx = cur.findIndex((c) => c.id === threadId);
        if (idx === -1) return cur;
        const now = new Date().toISOString();
        const current = cur[idx];
        ensureTimestamps(current, 'appendMessagesToConversation');
        const updated: ConversationThread = { ...current, lastActiveAt: now, messages: [...current.messages, ...messages] } as ConversationThread;
        const out = cur.slice();
        out[idx] = updated;
        return out;
      });
      return next.find((c) => c.id === threadId) || null;
    },
    finalizeThreadStatusAtomic: async (req: ReqLike, threadId: string, status: 'completed' | 'failed'): Promise<ConversationThread | null> => {
      const repo = requireConversationRepo(req);
      const next = await repo.mutate((cur) => {
        const idx = cur.findIndex((c) => c.id === threadId);
        if (idx === -1) return cur;
        const now = new Date().toISOString();
        const current = cur[idx];
        ensureTimestamps(current, 'finalizeThreadStatusAtomic');
        const updated: ConversationThread = { ...current, status, endedAt: now, lastActiveAt: now } as ConversationThread;
        const out = cur.slice();
        out[idx] = updated;
        return out;
      });
      return next.find((c) => c.id === threadId) || null;
    },
    getSettings: async (req?: ReqLike) => {
      const r = requireReq(req);
      return await loadSettings(r);
    },
    getProviderRepo: (req?: ReqLike) => getProviderEventsRepo(requireReq(req)),
    getTracesRepo: (req?: ReqLike) => resolveTracesRepo(requireReq(req)),
    getAccounts: async (req?: ReqLike) => {
      const repo = getAccountsRepo(requireReq(req));
      return await repo.getAll();
    },
    setAccounts: async (req: ReqLike, next: any[]) => {
      const repo = getAccountsRepo(requireReq(req));
      await repo.setAll(next);
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
      const conversations = await repo.getAll();
      return conversations.find((c: ConversationThread) => c.id === id) || null;
    },
    getOrchestrationLogByConversation: async (req: ReqLike, conversationId: string) => {
      const repo = getOrchestrationLogRepo(requireReq(req));
      return await repo.getByConversation(conversationId);
    },
    getWorkspaceItemsByConversation: async (req: ReqLike, conversationId: string) => {
      const repo = getWorkspaceItemsRepo(requireReq(req));
      return await repo.getByConversation(conversationId);
    },
  };
}
