import type { UserContext } from '../middleware/user-context';
import type { ReqLike } from '../interfaces';
import { RepoBundle } from '../repository/registry';
import type {
  SettingsRepository,
  EmailsRepository,
  FetcherLogRepository,
  ProviderEventsRepository,
  TracesRepository,
  OrchestrationLogRepository,
} from '../storage/sqlite';
import type {
  AccountsRepoInstance,
  AgentsRepoInstance,
  ConversationsRepoInstance,
  DirectorsRepoInstance,
  FiltersRepoInstance,
  ImprintsRepoInstance,
  MemoryRepoInstance,
  PromptsRepoInstance,
  TemplatesRepoInstance,
  WorkspaceItemsRepoInstance,
} from '../repository/wrappers';

export type { ReqLike } from '../interfaces';

/** Ensure the request-like object has a valid user context. */
export function requireReq<T extends ReqLike>(req?: T): T & { userContext: UserContext } {
  if (req && req.userContext && req.userContext.uid && req.userContext.repos) return req as T & { userContext: UserContext };
  throw new Error('User context required');
}

/** Get a specific per-user repository by key, requiring user context. */
export function requireUserRepo<K extends keyof RepoBundle>(req: ReqLike, key: K): RepoBundle[K] {
  return requireReq(req).userContext.repos[key];
}

/** Get the current user's UID, requiring user context. */
export function requireUid(req: ReqLike): string {
  return requireReq(req).userContext.uid;
}

/** Get the per-user RepoBundle, requiring user context. */
export function requireRepos(req: ReqLike): RepoBundle {
  return requireReq(req).userContext.repos;
}

export function getAccountsRepo(req: ReqLike): AccountsRepoInstance {
  return requireUserRepo(req, 'accounts');
}

export function getSettingsRepo(req: ReqLike): SettingsRepository {
  return requireUserRepo(req, 'settings');
}

export function getPromptsRepo(req: ReqLike): PromptsRepoInstance {
  return requireUserRepo(req, 'prompts');
}

export function getAgentsRepo(req: ReqLike): AgentsRepoInstance {
  return requireUserRepo(req, 'agents');
}

export function getDirectorsRepo(req: ReqLike): DirectorsRepoInstance {
  return requireUserRepo(req, 'directors');
}

export function getFiltersRepo(req: ReqLike): FiltersRepoInstance {
  return requireUserRepo(req, 'filters');
}

export function getTemplatesRepo(req: ReqLike): TemplatesRepoInstance {
  return requireUserRepo(req, 'templates');
}

export function getImprintsRepo(req: ReqLike): ImprintsRepoInstance {
  return requireUserRepo(req, 'imprints');
}

export function getWorkspaceItemsRepo(req: ReqLike): WorkspaceItemsRepoInstance {
  return requireUserRepo(req, 'workspaceItems');
}

export function getConversationsRepo(req: ReqLike): ConversationsRepoInstance {
  return requireUserRepo(req, 'conversations');
}

export function getMemoryRepo(req: ReqLike): MemoryRepoInstance {
  return requireUserRepo(req, 'memory');
}

export function getEmailsRepo(req: ReqLike): EmailsRepository {
  return requireUserRepo(req, 'emails');
}

export function getFetcherLogRepo(req: ReqLike): FetcherLogRepository {
  return requireUserRepo(req, 'fetcherLog');
}

export function getProviderEventsRepo(req: ReqLike): ProviderEventsRepository {
  return requireUserRepo(req, 'providerEvents');
}

export function getTracesRepo(req: ReqLike): TracesRepository {
  return requireUserRepo(req, 'traces');
}

export function getOrchestrationLogRepo(req: ReqLike): OrchestrationLogRepository {
  return requireUserRepo(req, 'orchestrationLog');
}
