import type { UserContext } from '../middleware/user-context';
import type { AppRequest, UserScopedContext } from '../interfaces';
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

export type { AppRequest, UserScopedContext } from '../interfaces';

function assertUserContext(value: unknown): asserts value is UserContext {
  if (!value || typeof value !== 'object') throw new Error('User context required');
  const ctx = value as UserContext;
  if (!ctx.uid || !ctx.repos) throw new Error('User context required');
}

export function requireAppRequest(req: unknown): AppRequest {
  const candidate = req as Partial<AppRequest> | undefined;
  if (candidate && candidate.userContext) {
    assertUserContext(candidate.userContext);
    return candidate as AppRequest;
  }
  throw new Error('AppRequest required');
}

export function requireUserScopedContext(ctx: unknown): UserScopedContext {
  const candidate = ctx as Partial<UserScopedContext> | undefined;
  if (candidate && candidate.userContext) {
    assertUserContext(candidate.userContext);
    return { userContext: candidate.userContext, traceId: candidate.traceId };
  }
  throw new Error('UserScopedContext required');
}

export type ContextInput = AppRequest | UserScopedContext | UserContext;

function hasUserContext(value: any): value is { userContext: UserContext; traceId?: string } {
  return value && typeof value === 'object' && 'userContext' in value;
}

function isUserContext(value: any): value is UserContext {
  return value && typeof value === 'object' && 'uid' in value && 'repos' in value;
}

export function toUserScopedContext(source: unknown): UserScopedContext {
  if (hasUserContext(source)) {
    assertUserContext(source.userContext);
    const traceFromRequest = (source as AppRequest).traceId;
    return {
      userContext: source.userContext,
      traceId: typeof traceFromRequest === 'string' ? traceFromRequest : source.traceId,
    };
  }
  if (isUserContext(source)) {
    assertUserContext(source);
    return { userContext: source };
  }
  throw new Error('User context required');
}

export function ensureContext(source?: unknown): UserScopedContext {
  if (!source) throw new Error('User context required');
  return toUserScopedContext(source);
}

export function requireContext(source?: unknown): UserScopedContext {
  return ensureContext(source);
}

function ensureBundle(input: unknown): RepoBundle {
  return toUserScopedContext(input).userContext.repos;
}

function ensureUid(input: unknown): string {
  return toUserScopedContext(input).userContext.uid;
}

export function requireRepos(source: unknown): RepoBundle {
  return ensureBundle(source);
}

export function requireUid(source: unknown): string {
  return ensureUid(source);
}

export function getAccountsRepo(source: ContextInput): AccountsRepoInstance {
  return ensureBundle(source).accounts;
}

export function getSettingsRepo(source: ContextInput): SettingsRepository {
  return ensureBundle(source).settings;
}

export function getPromptsRepo(source: ContextInput): PromptsRepoInstance {
  return ensureBundle(source).prompts;
}

export function getAgentsRepo(source: ContextInput): AgentsRepoInstance {
  return ensureBundle(source).agents;
}

export function getDirectorsRepo(source: ContextInput): DirectorsRepoInstance {
  return ensureBundle(source).directors;
}

export function getFiltersRepo(source: ContextInput): FiltersRepoInstance {
  return ensureBundle(source).filters;
}

export function getTemplatesRepo(source: ContextInput): TemplatesRepoInstance {
  return ensureBundle(source).templates;
}

export function getImprintsRepo(source: ContextInput): ImprintsRepoInstance {
  return ensureBundle(source).imprints;
}

export function getWorkspaceItemsRepo(source: ContextInput): WorkspaceItemsRepoInstance {
  return ensureBundle(source).workspaceItems;
}

export function getConversationsRepo(source: ContextInput): ConversationsRepoInstance {
  return ensureBundle(source).conversations;
}

export function getMemoryRepo(source: ContextInput): MemoryRepoInstance {
  return ensureBundle(source).memory;
}

export function getEmailsRepo(source: ContextInput): EmailsRepository {
  return ensureBundle(source).emails;
}

export function getFetcherLogRepo(source: ContextInput): FetcherLogRepository {
  return ensureBundle(source).fetcherLog;
}

export function getProviderEventsRepo(source: ContextInput): ProviderEventsRepository {
  return ensureBundle(source).providerEvents;
}

export function getTracesRepo(source: ContextInput): TracesRepository {
  return ensureBundle(source).traces;
}

export function getOrchestrationLogRepo(source: ContextInput): OrchestrationLogRepository {
  return ensureBundle(source).orchestrationLog;
}
