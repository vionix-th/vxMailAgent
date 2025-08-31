import { FetcherService, FetcherDeps, initFetcher } from './fetcher';
import { UserRequest } from '../middleware/user-context';
import { requireReq, requireUid } from '../utils/repo-access';

/**
 * Per-user fetcher dependencies that include user context
 */
export interface UserFetcherDeps {
  uid: string;
  getSettings: () => any;
  getFilters: () => any[];
  getDirectors: () => any[];
  getAgents: () => any[];
  getPrompts: () => any[];
  getConversations: () => any[];
  setConversations: (next: any[]) => void;
  getAccounts: () => any[];
  setAccounts: (accounts: any[]) => void;
  logOrch: (e: any) => void;
  logProviderEvent: (e: any) => void;
  getFetcherLog: () => any[];
  setFetcherLog: (next: any[]) => void;
  getToolHandler: () => (name: string, params: any) => Promise<any>;
  // Provides a mock per-user request used by logging/tracing
  getUserReq: () => UserRequest;
}

/**
 * Manager for per-user fetcher instances
 */
export class FetcherManager {
  private fetchers = new Map<string, FetcherService>();
  
  constructor(private createUserFetcher: (uid: string) => UserFetcherDeps) {}

  /**
   * Get or create fetcher for user
   */
  getFetcher(req: UserRequest): FetcherService {
    const ureq = requireReq(req);
    const uid = requireUid(ureq);
    if (!this.fetchers.has(uid)) {
      const userDeps = this.createUserFetcher(uid);
      // Convert user deps to standard fetcher deps
      const fetcherDeps: FetcherDeps = {
        getSettings: userDeps.getSettings,
        getFilters: userDeps.getFilters,
        getDirectors: userDeps.getDirectors,
        getAgents: userDeps.getAgents,
        getPrompts: userDeps.getPrompts,
        getConversations: userDeps.getConversations,
        setConversations: userDeps.setConversations,
        getAccounts: userDeps.getAccounts,
        setAccounts: userDeps.setAccounts,
        logOrch: userDeps.logOrch,
        logProviderEvent: userDeps.logProviderEvent,
        getFetcherLog: userDeps.getFetcherLog,
        setFetcherLog: userDeps.setFetcherLog,
        getToolHandler: userDeps.getToolHandler,
        getUserReq: userDeps.getUserReq,
      };
      this.fetchers.set(uid, initFetcher(fetcherDeps));
    }
    return this.fetchers.get(uid)!;
  }

  /**
   * Start fetcher loop for user or global
   */
  startFetcherLoop(req: UserRequest): void {
    const fetcher = this.getFetcher(req);
    fetcher.startFetcherLoop();
  }

  /**
   * Stop fetcher loop for user or global
   */
  stopFetcherLoop(req: UserRequest): void {
    const fetcher = this.getFetcher(req);
    fetcher.stopFetcherLoop();
  }

  /**
   * Get fetcher status for user or global
   */
  getStatus(req: UserRequest) {
    const fetcher = this.getFetcher(req);
    return fetcher.getStatus();
  }

  /**
   * Fetch emails for user or global
   */
  async fetchEmails(req: UserRequest): Promise<void> {
    const fetcher = this.getFetcher(req);
    await fetcher.fetchEmails();
  }

  /**
   * Get fetcher log for user or global
   */
  getFetcherLog(req: UserRequest) {
    const fetcher = this.getFetcher(req);
    return fetcher.getFetcherLog();
  }

  /**
   * Set fetcher log for user or global
   */
  setFetcherLog(req: UserRequest, next: any[]): void {
    const fetcher = this.getFetcher(req);
    fetcher.setFetcherLog(next);
  }

  /**
   * Clean up expired user fetchers (optional TTL-based eviction)
   */
  cleanup(): void {
    // Implementation could include TTL-based eviction similar to RepoBundleRegistry
    // For now, keep all fetchers active
  }
}
