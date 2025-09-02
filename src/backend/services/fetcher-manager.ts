import { FetcherService, FetcherDeps, initFetcher } from './fetcher';
import { ReqLike, requireReq, requireUid } from '../utils/repo-access';
import { FETCHER_MANAGER_TTL_MINUTES, FETCHER_MANAGER_MAX_FETCHERS } from '../config';
import logger from './logger';

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
  getUserReq: () => ReqLike;
}

interface FetcherEntry {
  service: FetcherService;
  lastAccessed: number;
}

/**
 * Manager for per-user fetcher instances
 */
export class FetcherManager {
  private fetchers = new Map<string, FetcherEntry>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(private createUserFetcher: (uid: string) => UserFetcherDeps) {
    this.startCleanupTimer();
  }

  /**
   * Get or create fetcher for user
   */
  getFetcher(req: ReqLike): FetcherService {
    const ureq = requireReq(req);
    const uid = requireUid(ureq);
    let entry = this.fetchers.get(uid);
    if (!entry) {
      if (this.fetchers.size >= FETCHER_MANAGER_MAX_FETCHERS) {
        this.evictOldest();
      }
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
      entry = { service: initFetcher(fetcherDeps), lastAccessed: Date.now() };
      this.fetchers.set(uid, entry);
    } else {
      entry.lastAccessed = Date.now();
    }
    return entry.service;
  }

  /**
   * Start fetcher loop for user or global
   */
  startFetcherLoop(req: ReqLike): void {
    const fetcher = this.getFetcher(req);
    fetcher.startFetcherLoop();
  }

  /**
   * Stop fetcher loop for user or global
   */
  stopFetcherLoop(req: ReqLike): void {
    const fetcher = this.getFetcher(req);
    fetcher.stopFetcherLoop();
  }

  /**
   * Get fetcher status for user or global
   */
  getStatus(req: ReqLike) {
    const fetcher = this.getFetcher(req);
    return fetcher.getStatus();
  }

  /**
   * Fetch emails for user or global
   */
  async fetchEmails(req: ReqLike): Promise<void> {
    const fetcher = this.getFetcher(req);
    await fetcher.fetchEmails();
  }

  /**
   * Get fetcher log for user or global
   */
  getFetcherLog(req: ReqLike) {
    const fetcher = this.getFetcher(req);
    return fetcher.getFetcherLog();
  }

  /**
   * Set fetcher log for user or global
   */
  setFetcherLog(req: ReqLike, next: any[]): void {
    const fetcher = this.getFetcher(req);
    fetcher.setFetcherLog(next);
  }

  /**
   * Clean up expired user fetchers (TTL-based eviction)
   */
  cleanup(): void {
    const ttlMs = Math.max(0, FETCHER_MANAGER_TTL_MINUTES) * 60 * 1000;
    if (ttlMs <= 0) return;
    const now = Date.now();
    for (const [uid, entry] of this.fetchers.entries()) {
      if (now - entry.lastAccessed > ttlMs) {
        try { entry.service.stopFetcherLoop(); } catch {}
        this.fetchers.delete(uid);
        logger.info('FETCHER_MANAGER evicted idle fetcher', { uid });
      }
    }
  }

  private evictOldest(): void {
    let oldestUid: string | null = null;
    let oldestTime = Infinity;
    for (const [uid, entry] of this.fetchers.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestUid = uid;
      }
    }
    if (oldestUid) {
      const entry = this.fetchers.get(oldestUid)!;
      try { entry.service.stopFetcherLoop(); } catch {}
      this.fetchers.delete(oldestUid);
      logger.info('FETCHER_MANAGER evicted oldest fetcher to respect cap', { uid: oldestUid });
    }
  }

  private startCleanupTimer(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }
}
