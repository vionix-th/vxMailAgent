import { UserContext } from '../middleware/user-context';
import { RepoBundle } from '../repository/registry';

/** Minimal request-like type carrying user context. */
export type ReqLike = { userContext?: UserContext };

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

/** Get all items from a repository by key. */
export async function repoGetAll<T = any>(req: ReqLike, key: keyof RepoBundle): Promise<T[]> {
  const repo = requireUserRepo(req, key) as unknown as { getAll: () => Promise<T[]> };
  if (!repo || typeof (repo as any).getAll !== 'function') throw new Error('Repository does not support getAll');
  return (repo as any).getAll();
}

/** Replace all items in a repository by key. */
export async function repoSetAll<T = any>(req: ReqLike, key: keyof RepoBundle, next: T[]): Promise<void> {
  const repo = requireUserRepo(req, key) as unknown as { setAll?: (n: T[]) => Promise<void> };
  if (!repo || typeof (repo as any).setAll !== 'function') throw new Error('Repository does not support setAll');
  await (repo as any).setAll!(next);
}
