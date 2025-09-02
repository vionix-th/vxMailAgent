import { Filter, Director, Agent, Prompt, Imprint, OrchestrationDiagnosticEntry, ConversationThread } from '../shared/types';
import { requireReq, requireUserRepo, repoGetAll, repoSetAll, ReqLike } from './utils/repo-access';
import { RepoBundle } from './repository/registry';

export interface LiveRepos {
  getPrompts(req?: ReqLike): Prompt[];
  setPrompts(req: ReqLike, next: Prompt[]): void;
  getAgents(req?: ReqLike): Agent[];
  setAgents(req: ReqLike, next: Agent[]): void;
  getDirectors(req?: ReqLike): Director[];
  setDirectors(req: ReqLike, next: Director[]): void;
  getFilters(req?: ReqLike): Filter[];
  setFilters(req: ReqLike, next: Filter[]): void;
  getImprints(req?: ReqLike): Imprint[];
  setImprints(req: ReqLike, next: Imprint[]): void;
  getOrchestrationLog(req?: ReqLike): OrchestrationDiagnosticEntry[];
  getConversations(req?: ReqLike): ConversationThread[];
  setConversations(req: ReqLike, next: ConversationThread[]): void;
  getSettings(req?: ReqLike): any;
  getProviderRepo(req?: ReqLike): any;
  getTracesRepo(req?: ReqLike): any;
}

export function createLiveRepos(): LiveRepos {
  const get = <T>(name: keyof RepoBundle) => (req?: ReqLike) => repoGetAll<T>(requireReq(req), name);
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
    getSettings: (req?: ReqLike) => {
      const r = requireReq(req);
      return repoGetAll<any>(r, 'settings')[0] || {};
    },
    getProviderRepo: (req?: ReqLike) => requireUserRepo(requireReq(req), 'providerEvents'),
    getTracesRepo: (req?: ReqLike) => requireUserRepo(requireReq(req), 'traces'),
  };
}
