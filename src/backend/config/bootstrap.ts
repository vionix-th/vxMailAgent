import { createJsonRepository } from '../repository/fileRepositories';
import { setUsersRepo, getUsersRepo } from '../services/users';
import { repoBundleRegistry } from '../repository/registry';
import { FetcherManager } from '../services/fetcher-manager';
import { createToolHandler } from '../toolCalls';
import { USERS_FILE } from '../utils/paths';
import { User, FetcherLogEntry } from '../../shared/types';
import { 
  logOrch as svcLogOrch, 
  logProviderEvent as svcLogProviderEvent 
} from '../services/logging';
import { isUser, assertArrayType } from '../utils/type-guards';

/**
 * Initialize system-level repositories and services.
 */
export function initializeRepositories(): void {
  // System-level repositories: only users registry remains
  const usersRepo = createJsonRepository<User>(USERS_FILE);
  setUsersRepo(usersRepo);
}

/**
 * Create and configure the FetcherManager with per-user factory.
 */
export function createFetcherManager(): FetcherManager {
  return new FetcherManager((uid: string) => {
    // Get user repository bundle directly for background operations
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
        // Create mock request for logging service
        const mockReq = { userContext: { uid, repos: userBundle } } as any;
        svcLogOrch(e, mockReq); 
      },
      logProviderEvent: (e: any) => { 
        const mockReq = { userContext: { uid, repos: userBundle } } as any;
        svcLogProviderEvent(e, mockReq); 
      },
      getFetcherLog: () => userBundle.fetcherLog.getAll(),
      setFetcherLog: (next: any[]) => userBundle.fetcherLog.setAll(next),
      getToolHandler: () => createToolHandler(userBundle),
      getUserReq: () => ({ userContext: { uid, repos: userBundle } } as any),
    };
  });
}

/**
 * Bootstrap per-user fetchers on server startup for users with auto-start enabled.
 */
export function bootstrapFetchers(fetcherManager: FetcherManager): void {
  try {
    const users = assertArrayType(getUsersRepo().getAll(), isUser, 'Invalid users data in repository');
    for (const u of users) {
      const uid = u.id;
      const bundle = repoBundleRegistry.getBundle(uid);
      const settings = bundle.settings.getAll()[0] || {};
      
      if (settings.fetcherAutoStart) {
        const mockReq = { userContext: { uid, repos: bundle } } as any;
        try {
          fetcherManager.startFetcherLoop(mockReq);
          console.log(`[BOOT] Started fetcher loop for user ${uid}`);
          
          // Log to per-user fetcher log as well
          const cur: FetcherLogEntry[] = fetcherManager.getFetcherLog(mockReq) as any;
          const entry: FetcherLogEntry = { 
            timestamp: new Date().toISOString(), 
            level: 'info', 
            event: 'boot_autostart', 
            message: 'Fetcher loop auto-started on server boot' 
          } as any;
          fetcherManager.setFetcherLog(mockReq, [...cur, entry] as any);
        } catch (e) {
          console.error(`[BOOT] Failed to start fetcher loop for user ${uid}:`, e);
          try {
            const cur: FetcherLogEntry[] = fetcherManager.getFetcherLog(mockReq) as any;
            const entry: FetcherLogEntry = { 
              timestamp: new Date().toISOString(), 
              level: 'error', 
              event: 'boot_autostart_failed', 
              message: 'Failed to auto-start fetcher loop on server boot', 
              detail: String((e as any)?.message || e) 
            } as any;
            fetcherManager.setFetcherLog(mockReq, [...cur, entry] as any);
          } catch {}
        }
      }
    }
  } catch (e) {
    console.error('[BOOT] Fetcher bootstrap failed:', e);
  }
}
