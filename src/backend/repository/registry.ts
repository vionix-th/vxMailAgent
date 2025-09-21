import { Repository } from './core';
import { ProviderEventsRepository, TracesRepository, FetcherLogRepository, OrchestrationLogRepository, createUserJsonRepository, createUserProviderEventsRepository, createUserTracesRepository, createUserFetcherLogRepository, createUserOrchestrationLogRepository } from './fileRepositories';
import { userPaths, UserPaths } from '../utils/paths';
import fs from 'fs';
import * as persistence from '../persistence';
import { USER_REGISTRY_TTL_MINUTES, USER_REGISTRY_MAX_ENTRIES, USER_MAX_CONVERSATIONS } from '../config';
import { Account, Agent, Director, Filter, Prompt, Imprint, ConversationThread, WorkspaceItem, TemplateItem, EmailEnvelope } from '../../shared/types';
import logger from '../services/logger';

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
  templates: Repository<TemplateItem>;
  imprints: Repository<Imprint>;
  workspaceItems: Repository<WorkspaceItem>;
  
  // Conversation and memory
  conversations: Repository<ConversationThread>;
  memory: Repository<any>;
  emails: Repository<EmailEnvelope>;
  
  // Logging repositories
  fetcherLog: FetcherLogRepository;
  providerEvents: ProviderEventsRepository;
  traces: TracesRepository;
  orchestrationLog: OrchestrationLogRepository;
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
  async getBundle(uid: string): Promise<RepoBundle> {
    let bundle = this.bundles.get(uid);
    
    if (bundle) {
      bundle.lastAccessed = Date.now();
      return bundle;
    }
    
    // Create new bundle
    const paths = userPaths(uid);

    // Initialize missing per-user JSON files. For Settings/Templates, persist real defaults to avoid consumer synthesis.
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
      paths.emails,
      paths.logs.fetcher,
      paths.logs.orchestration,
      paths.logs.providerEvents,
      paths.logs.traces,
    ];

    // Helper: safe read JSON (returns undefined on error)
    const readArray = async (file: string): Promise<any[] | undefined> => {
      try {
        if (!fs.existsSync(file)) return undefined;
        const data = await persistence.loadAndDecrypt(file, paths.root);
        return Array.isArray(data) ? data : [];
      } catch {
        return undefined;
      }
    };

    // Minimal defaults (authoritative producer side)
    const defaultSettings = () => ({
      virtualRoot: '',
      apiConfigs: [],
      signatures: {},
      fetcherAutoStart: true,
      sessionTimeoutMinutes: 15,
    });
    const defaultTemplates = (): TemplateItem[] => ([
      {
        id: 'prompt_optimizer',
        name: 'Prompt Optimizer (System)',
        messages: [
          {
            role: 'system',
            content:
              'You are a prompt optimization assistant for an email-oriented AI orchestration system.\n' +
              '- Strictly maintain role separation between director and agent prompts.\n' +
              '- Only include actor-actionable guidance: instructions the target actor can perform through its interfaces and responsibilities.\n' +
              '- Use only capabilities that are relevant and accessible to the actor. Derive these from the Affordances section when provided. Do not invent capabilities that are not listed.\n' +
              '- Infrastructure/meta directives are permitted only if they are explicitly actor-accessible and required for the task; otherwise omit them.\n' +
              '- Produce structured prompts using compact, human-readable sections with Markdown-style headings (no code fences).\n' +
              '  Sections to use when applicable: \n' +
              '  ## Intent\n' +
              '  ## Affordances (only capabilities from provided Affordances; no invented ones)\n' +
              '  ## IO (inputs/outputs in actor-actionable terms; no UI/frontend/transport details)\n' +
              '  ## Guidelines (concise directives the actor can execute)\n' +
              '  ## Examples (few-shot: realistic <input>/<output> pairs)\n' +
              '  Do NOT include markdown code fences. Keep it concise and readable.\n' +
              '- Prefer structured prompts and few-shot examples; avoid invented tools, APIs, or infrastructure.\n' +
              '- Keep prompts lean: avoid boilerplate disclaimers and non-essential notes.\n' +
              '- Output only JSON of the shape { "messages": [{ "role": "system|user|assistant", "content": "..." }], "notes": "..." }. No extra prose.'
          }
        ]
      }
    ]);

    for (const f of filesToInit) {
      try {
        if (!fs.existsSync(f)) {
          // Initialize with real defaults where applicable
          if (f === paths.settings) {
            await persistence.encryptAndPersist([defaultSettings()], f, paths.root);
          } else if (f === paths.templates) {
            await persistence.encryptAndPersist(defaultTemplates(), f, paths.root);
          } else {
            await persistence.encryptAndPersist([], f, paths.root);
          }
          continue;
        }
        // Upgrade path: if settings/templates exist but are empty arrays, persist defaults
        if (f === paths.settings) {
          const arr = await readArray(f);
          if (!arr || arr.length === 0) {
            await persistence.encryptAndPersist([defaultSettings()], f, paths.root);
          }
        } else if (f === paths.templates) {
          const arr = await readArray(f);
          if (!arr || arr.length === 0) {
            await persistence.encryptAndPersist(defaultTemplates(), f, paths.root);
          } else if (!arr.some((t: any) => t && t.id === 'prompt_optimizer')) {
            await persistence.encryptAndPersist([...(defaultTemplates()), ...arr], f, paths.root);
          }
        }
      } catch (e) {
        logger.warn('[REGISTRY] Failed to pre-create/upgrade user file', { file: f, error: e });
      }
    }
    
    bundle = {
      uid,
      paths,
      lastAccessed: Date.now(),
      
      // Core repositories
      accounts: createUserJsonRepository<Account>(paths.accounts, paths.root, undefined, uid),
      settings: createUserJsonRepository<any>(paths.settings, paths.root, undefined, uid),
      
      // Inventory repositories  
      prompts: createUserJsonRepository<Prompt>(paths.prompts, paths.root, undefined, uid),
      agents: createUserJsonRepository<Agent>(paths.agents, paths.root, undefined, uid),
      directors: createUserJsonRepository<Director>(paths.directors, paths.root, undefined, uid),
      filters: createUserJsonRepository<Filter>(paths.filters, paths.root, undefined, uid),
      templates: createUserJsonRepository<TemplateItem>(paths.templates, paths.root, undefined, uid),
      imprints: createUserJsonRepository<Imprint>(paths.imprints, paths.root, undefined, uid),
      workspaceItems: createUserJsonRepository<WorkspaceItem>(paths.workspaceItems, paths.root, undefined, uid),
      
      // Conversation and memory
      conversations: createUserJsonRepository<ConversationThread>(paths.conversations, paths.root, USER_MAX_CONVERSATIONS, uid),
      memory: createUserJsonRepository<any>(paths.memory, paths.root, undefined, uid),
      emails: createUserJsonRepository<EmailEnvelope>(paths.emails, paths.root, undefined, uid),
      
      // Logging repositories
      fetcherLog: createUserFetcherLogRepository(paths.logs.fetcher, paths.root, uid),
      providerEvents: createUserProviderEventsRepository(paths.logs.providerEvents, paths.root, uid),
      traces: createUserTracesRepository(paths.logs.traces, paths.root, uid),
      orchestrationLog: createUserOrchestrationLogRepository(paths.logs.orchestration, paths.root, uid),
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
        logger.info('[REGISTRY] Evicted expired bundle', { uid });
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
      logger.info('[REGISTRY] Evicted oldest bundle to make space', { uid: oldestUid });
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
export function getUserRepoBundle(uid: string): Promise<RepoBundle> {
  return repoBundleRegistry.getBundle(uid);
}
