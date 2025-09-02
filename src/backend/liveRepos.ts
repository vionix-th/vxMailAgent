import { Filter, Director, Agent, Prompt, Imprint, OrchestrationDiagnosticEntry, ConversationThread } from '../shared/types';
import { requireReq, requireUserRepo, repoGetAll, repoSetAll } from './utils/repo-access';
import { UserRequest } from './middleware/user-context';
import { RepoBundle } from './repository/registry';

export interface LiveRepos {
  getPrompts(req?: UserRequest): Prompt[];
  setPrompts(req: UserRequest, next: Prompt[]): void;
  getAgents(req?: UserRequest): Agent[];
  setAgents(req: UserRequest, next: Agent[]): void;
  getDirectors(req?: UserRequest): Director[];
  setDirectors(req: UserRequest, next: Director[]): void;
  getFilters(req?: UserRequest): Filter[];
  setFilters(req: UserRequest, next: Filter[]): void;
  getImprints(req?: UserRequest): Imprint[];
  setImprints(req: UserRequest, next: Imprint[]): void;
  getOrchestrationLog(req?: UserRequest): OrchestrationDiagnosticEntry[];
  getConversations(req?: UserRequest): ConversationThread[];
  setConversations(req: UserRequest, next: ConversationThread[]): void;
  getSettings(req?: UserRequest): any;
  getProviderRepo(req?: UserRequest): any;
  getTracesRepo(req?: UserRequest): any;
}

export function createLiveRepos(): LiveRepos {
  const get = <T>(name: keyof RepoBundle) => (req?: UserRequest) => repoGetAll<T>(requireReq(req), name);
  const set = <T>(name: keyof RepoBundle) => (req: UserRequest, next: T[]) => repoSetAll<T>(requireReq(req), name, next);

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
    getSettings: (req?: UserRequest) => {
      const r = requireReq(req);
      return repoGetAll<any>(r, 'settings')[0] || {};
    },
    getProviderRepo: (req?: UserRequest) => requireUserRepo(requireReq(req), 'providerEvents'),
    getTracesRepo: (req?: UserRequest) => requireUserRepo(requireReq(req), 'traces'),
  };
}
