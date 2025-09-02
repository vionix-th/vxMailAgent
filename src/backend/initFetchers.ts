import { FetcherManager } from './services/fetcher-manager';
import { repoBundleRegistry } from './repository/registry';
import { createToolHandler } from './toolCalls';
import { logOrch as svcLogOrch, logProviderEvent as svcLogProviderEvent } from './services/logging';
import { LiveRepos } from './liveRepos';
import logger from './services/logger';
import { getUsersRepo } from './services/users';
import { FetcherLogEntry } from '../shared/types';

/** Build a FetcherManager wired to per-user repo bundles and typed ReqLike contexts. */
export function createFetcherManager(_repos: LiveRepos) {
  const fetcherManager = new FetcherManager((uid: string) => {
    const userBundle = repoBundleRegistry.getBundle(uid);
    return {
      uid,
      getSettings: () => userBundle.settings.getAll()[0] || {},
      getFilters: () => userBundle.filters.getAll(),
      getDirectors: () => userBundle.directors.getAll(),
      getAgents: () => userBundle.agents.getAll(),
      getPrompts: () => userBundle.prompts.getAll(),
      getConversations: () => userBundle.conversations.getAll(),
      setConversations: (next: any[]) => userBundle.conversations.setAll(next),
      getAccounts: () => userBundle.accounts.getAll(),
      setAccounts: (accounts: any[]) => userBundle.accounts.setAll(accounts),
      logOrch: (e: any) => {
        const req = { userContext: { uid, repos: userBundle } };
        svcLogOrch(e, req);
      },
      logProviderEvent: (e: any) => {
        const req = { userContext: { uid, repos: userBundle } };
        svcLogProviderEvent(e, req);
      },
      getFetcherLog: () => userBundle.fetcherLog.getAll(),
      setFetcherLog: (next: any[]) => userBundle.fetcherLog.setAll(next),
      getToolHandler: () => createToolHandler(userBundle),
      getUserReq: () => ({ userContext: { uid, repos: userBundle } }),
    };
  });
  return fetcherManager;
}

/** Auto-start fetcher loops for users with fetcherAutoStart=true on server boot. */
export function bootAutoStart(fetcherManager: FetcherManager) {
  try {
    const users = getUsersRepo().getAll();
    for (const u of users) {
      const uid = u.id;
      const bundle = repoBundleRegistry.getBundle(uid);
      const settings = bundle.settings.getAll()[0] || {};
      if (settings.fetcherAutoStart) {
        const req = { userContext: { uid, repos: bundle } } as const;
        try {
          fetcherManager.startFetcherLoop(req);
          logger.info('Boot: started fetcher loop', { uid });
          // Log to per-user fetcher log as well
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
    }
  } catch (e) {
    logger.error('Boot: fetcher bootstrap failed', { err: e });
  }
}
