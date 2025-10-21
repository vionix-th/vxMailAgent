import { userPaths, UserPaths } from '../utils/paths';
import { USER_REGISTRY_TTL_MINUTES, USER_REGISTRY_MAX_ENTRIES } from '../config';
import {
  AccountsRepository as SqlAccountsRepository,
  AgentsRepository as SqlAgentsRepository,
  ConversationsRepository as SqlConversationsRepository,
  DirectorsRepository as SqlDirectorsRepository,
  EmailsRepository,
  FetcherLogRepository,
  FiltersRepository as SqlFiltersRepository,
  ImprintsRepository as SqlImprintsRepository,
  MemoryRepository as SqlMemoryRepository,
  OrchestrationLogRepository,
  PromptsRepository as SqlPromptsRepository,
  ProviderEventsRepository,
  SettingsRepository,
  TemplatesRepository as SqlTemplatesRepository,
  TracesRepository,
  WorkspaceItemsRepository as SqlWorkspaceItemsRepository,
  SystemUsersRepository,
} from '../storage/sqlite/repositories';
import { SqliteConnectionFactory, StorageHandle } from '../storage/sqlite';
import logger from '../services/logger';
import { RepositoryError } from '../services/error-handler';
import type { TemplateItem } from '../../shared/types';
import {
  augmentAccountsRepository,
  augmentAgentsRepository,
  augmentConversationsRepository,
  augmentDirectorsRepository,
  augmentFiltersRepository,
  augmentImprintsRepository,
  augmentMemoryRepository,
  augmentPromptsRepository,
  augmentTemplatesRepository,
  augmentWorkspaceItemsRepository,
  type AccountsRepoInstance,
  type AgentsRepoInstance,
  type ConversationsRepoInstance,
  type DirectorsRepoInstance,
  type FiltersRepoInstance,
  type ImprintsRepoInstance,
  type MemoryRepoInstance,
  type PromptsRepoInstance,
  type TemplatesRepoInstance,
  type WorkspaceItemsRepoInstance,
} from './wrappers';

let sqliteFactory: SqliteConnectionFactory | null = null;

export function configureSqliteFactory(factory: SqliteConnectionFactory): void {
  sqliteFactory = factory;
}

export interface RepoBundle {
  uid: string;
  paths: UserPaths;
  lastAccessed: number;
  handle: StorageHandle;

  accounts: AccountsRepoInstance;
  settings: SettingsRepository;

  prompts: PromptsRepoInstance;
  agents: AgentsRepoInstance;
  directors: DirectorsRepoInstance;
  filters: FiltersRepoInstance;
  templates: TemplatesRepoInstance;
  imprints: ImprintsRepoInstance;
  workspaceItems: WorkspaceItemsRepoInstance;

  conversations: ConversationsRepoInstance;
  memory: MemoryRepoInstance;
  emails: EmailsRepository;

  fetcherLog: FetcherLogRepository;
  providerEvents: ProviderEventsRepository;
  traces: TracesRepository;
  orchestrationLog: OrchestrationLogRepository;
}

function defaultTemplates(): TemplateItem[] {
  return [
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
  ];
}

export class RepoBundleRegistry {
  private bundles = new Map<string, RepoBundle>();
  private evictionTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startEvictionTimer();
  }

  async getBundle(uid: string): Promise<RepoBundle> {
    let bundle = this.bundles.get(uid);
    if (bundle) {
      bundle.lastAccessed = Date.now();
      return bundle;
    }

    if (!sqliteFactory) {
      throw new Error('Sqlite factory not configured');
    }

    const handle = sqliteFactory.getUserHandle(uid);
    const paths = userPaths(uid);

    bundle = {
      uid,
      paths,
      handle,
      lastAccessed: Date.now(),
      accounts: augmentAccountsRepository(new SqlAccountsRepository(handle)),
      settings: new SettingsRepository(handle),
      prompts: augmentPromptsRepository(new SqlPromptsRepository(handle)),
      agents: augmentAgentsRepository(new SqlAgentsRepository(handle)),
      directors: augmentDirectorsRepository(new SqlDirectorsRepository(handle)),
      filters: augmentFiltersRepository(new SqlFiltersRepository(handle)),
      templates: augmentTemplatesRepository(new SqlTemplatesRepository(handle)),
      imprints: augmentImprintsRepository(new SqlImprintsRepository(handle)),
      workspaceItems: augmentWorkspaceItemsRepository(new SqlWorkspaceItemsRepository(handle)),
      conversations: augmentConversationsRepository(new SqlConversationsRepository(handle)),
      memory: augmentMemoryRepository(new SqlMemoryRepository(handle)),
      emails: new EmailsRepository(handle),
      fetcherLog: new FetcherLogRepository(handle),
      providerEvents: new ProviderEventsRepository(handle),
      traces: new TracesRepository(handle),
      orchestrationLog: new OrchestrationLogRepository(handle),
    };

    try {
      await this.applyDefaults(bundle);
    } catch (error) {
      if (sqliteFactory) {
        try {
          await sqliteFactory.releaseUserHandle(uid);
        } catch (releaseError: unknown) {
          logger.warn('[REGISTRY] Failed to release SQLite handle after defaults error', {
            uid,
            error: releaseError instanceof Error ? releaseError.message : String(releaseError),
          });
        }
      }
      throw error;
    }

    if (this.bundles.size >= USER_REGISTRY_MAX_ENTRIES) {
      this.evictOldest();
    }
    this.bundles.set(uid, bundle);
    return bundle;
  }

  removeBundle(uid: string): void {
    const bundle = this.bundles.get(uid);
    if (!bundle) return;
    this.bundles.delete(uid);
    if (sqliteFactory) {
      sqliteFactory.releaseUserHandle(uid).catch((error) => {
        logger.warn('[REGISTRY] Failed to release SQLite handle', { uid, error: error?.message ?? String(error) });
      });
    }
  }

  getStats(): { totalBundles: number; oldestAccess: number | null; newestAccess: number | null } {
    if (this.bundles.size === 0) {
      return { totalBundles: 0, oldestAccess: null, newestAccess: null };
    }
    const accessTimes = Array.from(this.bundles.values()).map((b) => b.lastAccessed);
    return {
      totalBundles: this.bundles.size,
      oldestAccess: Math.min(...accessTimes),
      newestAccess: Math.max(...accessTimes),
    };
  }

  destroy(): void {
    this.stopEvictionTimer();
    for (const uid of Array.from(this.bundles.keys())) {
      this.removeBundle(uid);
    }
  }

  private async applyDefaults(bundle: RepoBundle): Promise<void> {
    const settings = await bundle.settings.load();
    if (!settings) {
      throw new RepositoryError('Settings not initialized', 'SETTINGS_NOT_INITIALIZED', 412);
    }

    const templates = await bundle.templates.list();
    const defaultTpl = defaultTemplates();
    if (!templates.length) {
      for (const tpl of defaultTpl) {
        await bundle.templates.insert(tpl);
      }
    } else if (!templates.some((t) => t.id === 'prompt_optimizer')) {
      const optimizer = defaultTpl.find((tpl) => tpl.id === 'prompt_optimizer');
      if (optimizer) {
        await bundle.templates.insert(optimizer);
      }
    }
  }

  private startEvictionTimer(): void {
    if (this.evictionTimer) return;
    this.evictionTimer = setInterval(() => {
      this.evictExpired();
    }, 5 * 60 * 1000);
  }

  private stopEvictionTimer(): void {
    if (!this.evictionTimer) return;
    clearInterval(this.evictionTimer);
    this.evictionTimer = null;
  }

  private evictExpired(): void {
    const now = Date.now();
    const ttlMs = USER_REGISTRY_TTL_MINUTES * 60 * 1000;
    for (const [uid, bundle] of this.bundles.entries()) {
      if (now - bundle.lastAccessed > ttlMs) {
        logger.info('[REGISTRY] Evicted expired bundle', { uid });
        this.removeBundle(uid);
      }
    }
  }

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
      logger.info('[REGISTRY] Evicted oldest bundle to make space', { uid: oldestUid });
      this.removeBundle(oldestUid);
    }
  }
}

export const repoBundleRegistry = new RepoBundleRegistry();

export function getUserRepoBundle(uid: string): Promise<RepoBundle> {
  return repoBundleRegistry.getBundle(uid);
}

export type SystemUsersRepo = SystemUsersRepository;
