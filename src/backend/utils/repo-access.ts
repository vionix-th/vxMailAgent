import type { UserContext } from '../middleware/user-context';
import type { ReqLike } from '../interfaces';
import { RepoBundle } from '../repository/registry';
import type {
  AccountsRepository,
  SettingsRepository,
  PromptsRepository,
  AgentsRepository,
  DirectorsRepository,
  FiltersRepository,
  TemplatesRepository,
  ImprintsRepository,
  WorkspaceItemsRepository,
  ConversationsRepository,
  MemoryRepository,
  EmailsRepository,
  FetcherLogRepository,
  ProviderEventsRepository,
  TracesRepository,
  OrchestrationLogRepository,
} from '../storage/sqlite';

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

export function getAccountsRepo(req: ReqLike): AccountsRepository {
  return requireUserRepo(req, 'accounts');
}

export function getSettingsRepo(req: ReqLike): SettingsRepository {
  return requireUserRepo(req, 'settings');
}

export function getPromptsRepo(req: ReqLike): PromptsRepository {
  return requireUserRepo(req, 'prompts');
}

export function getAgentsRepo(req: ReqLike): AgentsRepository {
  return requireUserRepo(req, 'agents');
}

export function getDirectorsRepo(req: ReqLike): DirectorsRepository {
  return requireUserRepo(req, 'directors');
}

export function getFiltersRepo(req: ReqLike): FiltersRepository {
  return requireUserRepo(req, 'filters');
}

export function getTemplatesRepo(req: ReqLike): TemplatesRepository {
  return requireUserRepo(req, 'templates');
}

export function getImprintsRepo(req: ReqLike): ImprintsRepository {
  return requireUserRepo(req, 'imprints');
}

export function getWorkspaceItemsRepo(req: ReqLike): WorkspaceItemsRepository {
  return requireUserRepo(req, 'workspaceItems');
}

export function getConversationsRepo(req: ReqLike): ConversationsRepository {
  return requireUserRepo(req, 'conversations');
}

export function getMemoryRepo(req: ReqLike): MemoryRepository {
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
