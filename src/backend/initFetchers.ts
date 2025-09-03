import { FetcherManager } from './services/fetcher-manager';
import { LiveRepos } from './liveRepos';
import logger from './services/logger';
import { getUsersRepo } from './services/users';

/** Build a FetcherManager wired to per-user repo bundles and typed ReqLike contexts. */
export function createFetcherManager(_repos: LiveRepos) {
  const fetcherManager = new FetcherManager(_repos);
  return fetcherManager;
}

/** Auto-start fetcher loops for users with fetcherAutoStart=true on server boot. */
export function bootAutoStart(_fetcherManager: FetcherManager) {
  (async () => {
    try {
      const users = await getUsersRepo().getAll();
      for (const u of users) {
        const uid = (u as any).id;
        try {
          // TODO: Implement proper bundle access for auto-start
          logger.info('Boot: skipping auto-start for user (not implemented)', { uid });
        } catch (e) {
          logger.error('Boot: error preparing user bundle', { uid, err: e });
        }
      }
    } catch (e) {
      logger.error('Boot: failed to enumerate users for auto-start', { err: e });
    }
  })();
}
