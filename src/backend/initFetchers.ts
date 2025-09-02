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
  const fetcherManager = new FetcherManager((req: ReqLike) => {
    const uid = requireUid(req);
    const getBundle = async () => {
      const existing = (req as any)?.userContext?.repos;
      if (existing) return existing;
      return await repoBundleRegistry.getBundle(uid);
    };
    return {
      uid,
      getSettings: async () => {
        const b = await getBundle();
        const arr = await b.settings.getAll();
        return arr[0] || {};
      },
      getFilters: async () => (await getBundle()).filters.getAll(),
      getDirectors: async () => (await getBundle()).directors.getAll(),
      getAgents: async () => (await getBundle()).agents.getAll(),
      getPrompts: async () => (await getBundle()).prompts.getAll(),
      getConversations: async () => (await getBundle()).conversations.getAll(),
      setConversations: async (next: any[]) => { const b = await getBundle(); await b.conversations.setAll(next); },
      getAccounts: async () => (await getBundle()).accounts.getAll(),
      setAccounts: async (accounts: any[]) => { const b = await getBundle(); await b.accounts.setAll(accounts); },
      logOrch: (e: any) => { void getBundle().then(b => svcLogOrch(e, { userContext: { uid, repos: b } })); },
      logProviderEvent: (e: any) => { void getBundle().then(b => svcLogProviderEvent(e, { userContext: { uid, repos: b } })); },
      getFetcherLog: async () => (await getBundle()).fetcherLog.getAll(),
      setFetcherLog: async (next: any[]) => { const b = await getBundle(); await b.fetcherLog.setAll(next); },
      getToolHandler: () => (name: string, params: any) => getBundle().then(b => createToolHandler(b)(name, params)),
      getUserReq: () => (req && (req as any)?.userContext?.repos ? req : ({ userContext: { uid } } as any)),
    } as any;
  });
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
