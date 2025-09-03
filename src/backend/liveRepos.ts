import { Filter, Director, Agent, Prompt, Imprint, OrchestrationDiagnosticEntry, ConversationThread } from '../shared/types';
import { requireReq, requireUserRepo, repoGetAll, repoSetAll, ReqLike } from './utils/repo-access';
import { RepoBundle } from './repository/registry';

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
  getOrchestrationLog(req?: ReqLike): Promise<OrchestrationDiagnosticEntry[]>;
  getConversations(req?: ReqLike): Promise<ConversationThread[]>;
  setConversations(req: ReqLike, next: ConversationThread[]): Promise<void>;
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
    getOrchestrationLog: get<OrchestrationDiagnosticEntry>('orchestrationLog'),
    getConversations: get<ConversationThread>('conversations'),
    setConversations: set<ConversationThread>('conversations'),
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
  };
}
