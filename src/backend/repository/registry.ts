import { Repository } from './core';
import { ProviderEventsRepository, TracesRepository, createUserJsonRepository, createUserProviderEventsRepository, createUserTracesRepository } from './fileRepositories';
import { userPaths, UserPaths } from '../utils/paths';
import fs from 'fs';
import * as persistence from '../persistence';
import { USER_REGISTRY_TTL_MINUTES, USER_REGISTRY_MAX_ENTRIES, USER_MAX_CONVERSATIONS, USER_MAX_LOGS_PER_TYPE } from '../config';
import { Account, Agent, Director, Filter, Prompt, Imprint, ConversationThread, WorkspaceItem } from '../../shared/types';

/**
 * Bundle of all repositories for a single user.
 */
export interface RepoBundle {
  uid: string;
  paths: UserPaths;
  lastAccessed: number;
  
  // Core repositories
  accounts: Repository<Account>;
  settings: Repository<any>;
  
  // Inventory repositories
  prompts: Repository<Prompt>;
  agents: Repository<Agent>;
  directors: Repository<Director>;
  filters: Repository<Filter>;
  // templates: Repository<Template>; // Template type not available
  imprints: Repository<Imprint>;
  workspaceItems: Repository<WorkspaceItem>;
  
  // Conversation and memory
  conversations: Repository<ConversationThread>;
  memory: Repository<any>;
  
  // Logging repositories
  fetcherLog: Repository<any>;
  providerEvents: ProviderEventsRepository;
  traces: TracesRepository;
  orchestrationLog: Repository<any>;
}

/**
 * Registry for managing per-user repository bundles with TTL eviction.
 */
export class RepoBundleRegistry {
  private bundles = new Map<string, RepoBundle>();
  private evictionTimer: NodeJS.Timeout | null = null;
  
  constructor() {
    this.startEvictionTimer();
  }
  
  /**
   * Gets or creates a repository bundle for a user.
   * @param uid - User ID (must be pre-validated)
   * @returns Repository bundle for the user
   */
  getBundle(uid: string): RepoBundle {
    let bundle = this.bundles.get(uid);
    
    if (bundle) {
      bundle.lastAccessed = Date.now();
      return bundle;
    }
    
    // Create new bundle
    const paths = userPaths(uid);

    // Initialize missing per-user JSON files with empty arrays to avoid runtime errors
    const filesToInit: string[] = [
      paths.accounts,
      paths.settings,
      paths.prompts,
      paths.agents,
      paths.directors,
      paths.filters,
      paths.templates,
      paths.imprints,
      paths.conversations,
      paths.workspaceItems,
      paths.memory,
      paths.logs.fetcher,
      paths.logs.orchestration,
      paths.logs.providerEvents,
      paths.logs.traces,
    ];
    for (const f of filesToInit) {
      try {
        if (!fs.existsSync(f)) {
          persistence.encryptAndPersist([], f, paths.root);
        }
      } catch (e) {
        console.warn(`[REGISTRY] Failed to pre-create user file ${f}:`, e);
      }
    }
    
    bundle = {
      uid,
      paths,
      lastAccessed: Date.now(),
      
      // Core repositories
      accounts: createUserJsonRepository<Account>(paths.accounts, paths.root),
      settings: createUserJsonRepository<any>(paths.settings, paths.root),
      
      // Inventory repositories  
      prompts: createUserJsonRepository<Prompt>(paths.prompts, paths.root),
      agents: createUserJsonRepository<Agent>(paths.agents, paths.root),
      directors: createUserJsonRepository<Director>(paths.directors, paths.root),
      filters: createUserJsonRepository<Filter>(paths.filters, paths.root),
      // templates: createUserJsonRepository<any>(paths.templates, paths.root), // Template type not available
      imprints: createUserJsonRepository<Imprint>(paths.imprints, paths.root),
      workspaceItems: createUserJsonRepository<WorkspaceItem>(paths.workspaceItems, paths.root),
      
      // Conversation and memory
      conversations: createUserJsonRepository<ConversationThread>(paths.conversations, paths.root, USER_MAX_CONVERSATIONS),
      memory: createUserJsonRepository<any>(paths.memory, paths.root),
      
      // Logging repositories
      fetcherLog: createUserJsonRepository<any>(paths.logs.fetcher, paths.root, USER_MAX_LOGS_PER_TYPE),
      providerEvents: createUserProviderEventsRepository(paths.logs.providerEvents, paths.root),
      traces: createUserTracesRepository(paths.logs.traces, paths.root),
      orchestrationLog: createUserJsonRepository<any>(paths.logs.orchestration, paths.root),
    };
    
    // Check registry size limits
    if (this.bundles.size >= USER_REGISTRY_MAX_ENTRIES) {
      this.evictOldest();
    }
    this.bundles.set(uid, bundle);
    return bundle;
  }
  
  /**
   * Removes a user's bundle from the registry.
   * @param uid - User ID
   */
  removeBundle(uid: string): void {
    this.bundles.delete(uid);
  }
  
  /**
   * Gets current registry statistics.
   */
  getStats(): { totalBundles: number; oldestAccess: number | null; newestAccess: number | null } {
    if (this.bundles.size === 0) {
      return { totalBundles: 0, oldestAccess: null, newestAccess: null };
    }
    
    const accessTimes = Array.from(this.bundles.values()).map(b => b.lastAccessed);
    return {
      totalBundles: this.bundles.size,
      oldestAccess: Math.min(...accessTimes),
      newestAccess: Math.max(...accessTimes),
    };
  }
  
  /**
   * Starts the TTL eviction timer.
   */
  private startEvictionTimer(): void {
    if (this.evictionTimer) return;
    
    // Run eviction every 5 minutes
    this.evictionTimer = setInterval(() => {
      this.evictExpired();
    }, 5 * 60 * 1000);
  }
  
  /**
   * Stops the TTL eviction timer.
   */
  private stopEvictionTimer(): void {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }
  }
  
  /**
   * Evicts expired bundles based on TTL.
   */
  private evictExpired(): void {
    const now = Date.now();
    const ttlMs = USER_REGISTRY_TTL_MINUTES * 60 * 1000;
    
    for (const [uid, bundle] of this.bundles.entries()) {
      if (now - bundle.lastAccessed > ttlMs) {
        this.bundles.delete(uid);
        console.log(`[REGISTRY] Evicted expired bundle for user ${uid}`);
      }
    }
  }
  
  /**
   * Evicts the oldest bundle when registry is full.
   */
  private evictOldest(): void {
    let oldestUid: string | null = null;
    let oldestTime = Date.now();
    
    for (const [uid, bundle] of this.bundles.entries()) {
      if (bundle.lastAccessed < oldestTime) {
        oldestTime = bundle.lastAccessed;
        oldestUid = uid;
      }
    }
    
    if (oldestUid) {
      this.bundles.delete(oldestUid);
      console.log(`[REGISTRY] Evicted oldest bundle for user ${oldestUid} to make space`);
    }
  }
  
  /**
   * Cleanup method for graceful shutdown.
   */
  destroy(): void {
    this.stopEvictionTimer();
    this.bundles.clear();
  }
}

// Global registry instance
export const repoBundleRegistry = new RepoBundleRegistry();

/**
 * Gets a repository bundle for a user with validation.
 * @param uid - User ID (must be pre-validated)
 * @returns Repository bundle
 */
export function getUserRepoBundle(uid: string): RepoBundle {
  return repoBundleRegistry.getBundle(uid);
}
