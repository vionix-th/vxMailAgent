import { FetcherManager } from './services/fetcher-manager';
import { repoBundleRegistry } from './repository/registry';
import { createToolHandler } from './toolCalls';
import { logOrch as svcLogOrch, logProviderEvent as svcLogProviderEvent } from './services/logging';
import { LiveRepos } from './liveRepos';
import logger from './services/logger';
import { getUsersRepo } from './services/users';
import { FetcherLogEntry } from '../shared/types';
import { ReqLike, requireUid } from './utils/repo-access';

/** Build a FetcherManager wired to per-user repo bundles and typed ReqLike contexts. */
export function createFetcherManager(_repos: LiveRepos) {
  const fetcherManager = new FetcherManager(
    _repos,
    (req: ReqLike, e: any) => { void svcLogOrch(e, req); },
    (req: ReqLike, e: any) => { void svcLogProviderEvent(e, req); },
    (req: ReqLike) => (name: string, params: any) => {
      const uid = requireUid(req);
      return repoBundleRegistry.getBundle(uid).then(b => createToolHandler(b)(name, params));
    }
  );
  return fetcherManager;
}

/** Auto-start fetcher loops for users with fetcherAutoStart=true on server boot. */
export function bootAutoStart(fetcherManager: FetcherManager) {
  (async () => {
    try {
      const users = await getUsersRepo().getAll();
      for (const u of users) {
        const uid = (u as any).id;
        try {
          const bundle = await repoBundleRegistry.getBundle(uid);
          const settingsArr = await bundle.settings.getAll();
          const settings = settingsArr[0] || {};
          if (settings.fetcherAutoStart) {
            const req = { userContext: { uid, repos: bundle } } as const;
            try {
              fetcherManager.startFetcherLoop(req);
              logger.info('Boot: started fetcher loop', { uid });
              const cur: FetcherLogEntry[] = fetcherManager.getFetcherLog(req) as any;
              const entry: FetcherLogEntry = { timestamp: new Date().toISOString(), level: 'info', event: 'boot_autostart', message: 'Fetcher loop auto-started on server boot' } as any;
              fetcherManager.setFetcherLog(req, [...cur, entry] as any);
            } catch (e) {
              logger.error('Boot: failed to start fetcher loop', { uid, err: e });
              try {
                const cur: FetcherLogEntry[] = fetcherManager.getFetcherLog(req) as any;
                const entry: FetcherLogEntry = { timestamp: new Date().toISOString(), level: 'error', event: 'boot_autostart_failed', message: 'Failed to auto-start fetcher loop on server boot', detail: String((e as any)?.message || e) } as any;
                fetcherManager.setFetcherLog(req, [...cur, entry] as any);
              } catch {}
            }
          }
        } catch (e) {
          logger.error('Boot: error preparing user bundle', { uid, err: e });
        }
      }
    } catch (e) {
      logger.error('Boot: fetcher bootstrap failed', { err: e });
    }
  })();
}
