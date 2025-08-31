import { UserRequest, hasUserContext, getUserContext } from '../middleware/user-context';
import { RepoBundle } from '../repository/registry';

/** Ensure the request has a valid user context. */
export function requireReq(req?: UserRequest): UserRequest {
  if (req && hasUserContext(req)) return req;
  throw new Error('User context required');
}

/** Get a specific per-user repository by key, requiring user context. */
export function requireUserRepo<K extends keyof RepoBundle>(req: UserRequest, key: K): RepoBundle[K] {
  return getUserContext(req).repos[key];
}

/** Get all items from a repository by key. */
export function repoGetAll<T = any>(req: UserRequest, key: keyof RepoBundle): T[] {
  const repo = requireUserRepo(req, key) as unknown as { getAll: () => T[] };
  if (!repo || typeof repo.getAll !== 'function') throw new Error('Repository does not support getAll');
  return repo.getAll();
}

/** Replace all items in a repository by key. */
export function repoSetAll<T = any>(req: UserRequest, key: keyof RepoBundle, next: T[]): void {
  const repo = requireUserRepo(req, key) as unknown as { setAll?: (n: T[]) => void };
  if (!repo || typeof repo.setAll !== 'function') throw new Error('Repository does not support setAll');
  repo.setAll!(next);
}
