import { FetcherService, FetcherDeps, initFetcher } from './fetcher';
import { UserRequest, hasUserContext, getUserContext } from '../middleware/user-context';

/**
 * Per-user fetcher dependencies that include user context
 */
export interface UserFetcherDeps extends Omit<FetcherDeps, 'getConversations' | 'setConversations' | 'getAccounts' | 'setAccounts' | 'logOrch' | 'logProviderEvent' | 'getFetcherLog' | 'setFetcherLog' | 'getToolHandler'> {
  uid: string;
  getConversations: (req?: UserRequest) => any[];
  setConversations: (req: UserRequest, next: any[]) => void;
  getAccounts: (req?: UserRequest) => any[];
  setAccounts: (req: UserRequest, accounts: any[]) => void;
  logOrch: (e: any, req?: UserRequest) => void;
  logProviderEvent: (e: any, req?: UserRequest) => void;
  getFetcherLog: (req?: UserRequest) => any[];
  setFetcherLog: (req: UserRequest, next: any[]) => void;
  getToolHandler: (req?: UserRequest) => (name: string, params: any) => Promise<any>;
}

/**
 * Manager for per-user fetcher instances
 */
export class FetcherManager {
  private fetchers = new Map<string, FetcherService>();
  private globalFetcher: FetcherService | null = null;

  constructor(private createUserFetcher: (uid: string) => UserFetcherDeps) {}

  /**
   * Initialize global fetcher for fallback
   */
  initGlobalFetcher(deps: FetcherDeps): void {
    this.globalFetcher = initFetcher(deps);
  }

  /**
   * Get or create fetcher for user
   */
  getFetcher(req?: UserRequest): FetcherService | null {
    if (req && hasUserContext(req)) {
      const uid = getUserContext(req).uid;
      if (!this.fetchers.has(uid)) {
        const userDeps = this.createUserFetcher(uid);
        // Convert user deps to standard fetcher deps
        const fetcherDeps: FetcherDeps = {
          getSettings: userDeps.getSettings,
          getFilters: userDeps.getFilters,
          getDirectors: userDeps.getDirectors,
          getAgents: userDeps.getAgents,
          getPrompts: userDeps.getPrompts,
          getConversations: () => userDeps.getConversations(req),
          setConversations: (next) => userDeps.setConversations(req, next),
          getAccounts: () => userDeps.getAccounts(req),
          setAccounts: (accounts) => userDeps.setAccounts(req, accounts),
          logOrch: (e) => userDeps.logOrch(e, req),
          logProviderEvent: (e) => userDeps.logProviderEvent(e, req),
          getFetcherLog: () => userDeps.getFetcherLog(req),
          setFetcherLog: (next) => userDeps.setFetcherLog(req, next),
          getToolHandler: () => userDeps.getToolHandler(req),
        };
        this.fetchers.set(uid, initFetcher(fetcherDeps));
      }
      return this.fetchers.get(uid)!;
    }
    return this.globalFetcher;
  }

  /**
   * Start fetcher loop for user or global
   */
  startFetcherLoop(req?: UserRequest): void {
    const fetcher = this.getFetcher(req);
    if (fetcher) {
      fetcher.startFetcherLoop();
    }
  }

  /**
   * Stop fetcher loop for user or global
   */
  stopFetcherLoop(req?: UserRequest): void {
    const fetcher = this.getFetcher(req);
    if (fetcher) {
      fetcher.stopFetcherLoop();
    }
  }

  /**
   * Get fetcher status for user or global
   */
  getStatus(req?: UserRequest) {
    const fetcher = this.getFetcher(req);
    return fetcher ? fetcher.getStatus() : { active: false, running: false, lastRun: null, nextRun: null, accountStatus: {} };
  }

  /**
   * Fetch emails for user or global
   */
  async fetchEmails(req?: UserRequest): Promise<void> {
    const fetcher = this.getFetcher(req);
    if (fetcher) {
      await fetcher.fetchEmails();
    }
  }

  /**
   * Get fetcher log for user or global
   */
  getFetcherLog(req?: UserRequest) {
    const fetcher = this.getFetcher(req);
    return fetcher ? fetcher.getFetcherLog() : [];
  }

  /**
   * Set fetcher log for user or global
   */
  setFetcherLog(req: UserRequest, next: any[]): void {
    const fetcher = this.getFetcher(req);
    if (fetcher) {
      fetcher.setFetcherLog(next);
    }
  }

  /**
   * Clean up expired user fetchers (optional TTL-based eviction)
   */
  cleanup(): void {
    // Implementation could include TTL-based eviction similar to RepoBundleRegistry
    // For now, keep all fetchers active
  }
}
