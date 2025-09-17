import { Filter, Director, Agent, Prompt, Imprint, OrchestrationEvent, ConversationThread, EmailEnvelope, ProviderEvent } from '../shared/types';
import { requireReq, requireUserRepo, repoGetAll, repoSetAll, requireRepos, ReqLike } from './utils/repo-access';
import { RepoBundle } from './repository/registry';
import type { ConversationThread } from '../shared/types';

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
  /** Append one or more messages to a thread atomically. */
  appendMessagesToConversation(req: ReqLike, threadId: string, messages: any[]): Promise<ConversationThread | null>;
  /** Finalize a thread's status atomically. */
  finalizeThreadStatusAtomic(req: ReqLike, threadId: string, status: 'completed' | 'failed'): Promise<ConversationThread | null>;
  getEmails(req?: ReqLike): Promise<EmailEnvelope[]>;
  setEmails(req: ReqLike, next: EmailEnvelope[]): Promise<void>;
  getProviderEvents(req?: ReqLike): Promise<ProviderEvent[]>;
  getConversationById(req: ReqLike, id: string): Promise<ConversationThread | null>;
  getSettings(req?: ReqLike): Promise<any>;
  getProviderRepo(req?: ReqLike): any;
  getTracesRepo(req?: ReqLike): any;
  getAccounts(req?: ReqLike): Promise<any[]>;
  setAccounts(req: ReqLike, next: any[]): Promise<void>;
  getFetcherLog(req?: ReqLike): Promise<any[]>;
  setFetcherLog(req: ReqLike, next: any[]): Promise<void>;
}

export function createLiveRepos(): LiveRepos {
  const get = <T>(name: keyof RepoBundle) => async (req?: ReqLike) => {
    const arr = await repoGetAll<T>(requireReq(req), name);
    return Array.isArray(arr) ? arr : [];
  };
  const set = <T>(name: keyof RepoBundle) => (req: ReqLike, next: T[]) => repoSetAll<T>(requireReq(req), name, next);

  return {
    getPrompts: get<Prompt>('prompts'),
    setPrompts: set<Prompt>('prompts'),
    getAgents: get<Agent>('agents'),
    setAgents: set<Agent>('agents'),
    getDirectors: get<Director>('directors'),
    setDirectors: set<Director>('directors'),
    getFilters: get<Filter>('filters'),
    setFilters: set<Filter>('filters'),
    getImprints: get<Imprint>('imprints'),
    setImprints: set<Imprint>('imprints'),
    getOrchestrationLog: get<OrchestrationEvent>('orchestrationLog'),
    getConversations: get<ConversationThread>('conversations'),
    setConversations: set<ConversationThread>('conversations'),
    appendMessagesToConversation: async (req: ReqLike, threadId: string, messages: any[]): Promise<ConversationThread | null> => {
      const r = requireReq(req);
      const bundle = requireRepos(r);
      const repo = bundle.conversations as unknown as { mutate?: (fn: (cur: ConversationThread[]) => Promise<ConversationThread[]> | ConversationThread[]) => Promise<ConversationThread[]> };
      if (!repo || typeof repo.mutate !== 'function') {
        // Fallback (non-atomic): preserve prior behavior if mutate is unavailable
        const list = await repoGetAll<ConversationThread>(r, 'conversations');
        const idx = list.findIndex((c) => c.id === threadId);
        if (idx === -1) return null;
        const now = new Date().toISOString();
        const updated: ConversationThread = { ...list[idx], lastActiveAt: now, messages: [...list[idx].messages, ...(messages || [])] } as ConversationThread;
        const next = list.slice();
        next[idx] = updated;
        await repoSetAll<ConversationThread>(r, 'conversations', next);
        return updated;
      }
      const next = await repo.mutate((cur) => {
        const idx = cur.findIndex((c) => c.id === threadId);
        if (idx === -1) return cur;
        const now = new Date().toISOString();
        const updated: ConversationThread = { ...cur[idx], lastActiveAt: now, messages: [...cur[idx].messages, ...(messages || [])] } as ConversationThread;
        const out = cur.slice();
        out[idx] = updated;
        return out;
      });
      return next.find((c) => c.id === threadId) || null;
    },
    finalizeThreadStatusAtomic: async (req: ReqLike, threadId: string, status: 'completed' | 'failed'): Promise<ConversationThread | null> => {
      const r = requireReq(req);
      const bundle = requireRepos(r);
      const repo = bundle.conversations as unknown as { mutate?: (fn: (cur: ConversationThread[]) => Promise<ConversationThread[]> | ConversationThread[]) => Promise<ConversationThread[]> };
      if (!repo || typeof repo.mutate !== 'function') {
        const list = await repoGetAll<ConversationThread>(r, 'conversations');
        const idx = list.findIndex((c) => c.id === threadId);
        if (idx === -1) return null;
        const now = new Date().toISOString();
        const updated: ConversationThread = { ...list[idx], status, endedAt: now, lastActiveAt: now } as ConversationThread;
        const next = list.slice();
        next[idx] = updated;
        await repoSetAll<ConversationThread>(r, 'conversations', next);
        return updated;
      }
      const next = await repo.mutate((cur) => {
        const idx = cur.findIndex((c) => c.id === threadId);
        if (idx === -1) return cur;
        const now = new Date().toISOString();
        const updated: ConversationThread = { ...cur[idx], status, endedAt: now, lastActiveAt: now } as ConversationThread;
        const out = cur.slice();
        out[idx] = updated;
        return out;
      });
      return next.find((c) => c.id === threadId) || null;
    },
    getSettings: async (req?: ReqLike) => {
      const r = requireReq(req);
      const arr = await repoGetAll<any>(r, 'settings');
      const s = (Array.isArray(arr) ? arr : [])[0] || {};
      const apiConfigs = Array.isArray(s.apiConfigs) ? s.apiConfigs : [];
      return { ...s, apiConfigs };
    },
    getProviderRepo: (req?: ReqLike) => requireUserRepo(requireReq(req), 'providerEvents'),
    getTracesRepo: (req?: ReqLike) => requireUserRepo(requireReq(req), 'traces'),
    getAccounts: async (req?: ReqLike) => {
      const arr = await repoGetAll<any>(requireReq(req), 'accounts');
      return Array.isArray(arr) ? arr : [];
    },
    setAccounts: (req: ReqLike, next: any[]) => repoSetAll<any>(requireReq(req), 'accounts', next),
    getFetcherLog: async (req?: ReqLike) => {
      const arr = await repoGetAll<any>(requireReq(req), 'fetcherLog');
      return Array.isArray(arr) ? arr : [];
    },
    setFetcherLog: (req: ReqLike, next: any[]) => repoSetAll<any>(requireReq(req), 'fetcherLog', next),
    getEmails: get<EmailEnvelope>('emails'),
    setEmails: set<EmailEnvelope>('emails'),
    getProviderEvents: async (req?: ReqLike) => {
      const repo = requireUserRepo(requireReq(req), 'providerEvents');
      return await repo.getAll();
    },
    getConversationById: async (req: ReqLike, id: string) => {
      const conversations = await get<ConversationThread>('conversations')(req);
      return conversations.find((c: ConversationThread) => c.id === id) || null;
    },
  };
}
