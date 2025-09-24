import type {
  Account,
  Agent,
  ConversationThread,
  Director,
  Filter,
  Imprint,
  MemoryEntry,
  Prompt,
  PromptMessage,
  TemplateItem,
  WorkspaceItem,
} from '../../shared/types';
import type {
  AccountsRepository as SqlAccountsRepository,
  PromptsRepository as SqlPromptsRepository,
  AgentsRepository as SqlAgentsRepository,
  DirectorsRepository as SqlDirectorsRepository,
  FiltersRepository as SqlFiltersRepository,
  TemplatesRepository as SqlTemplatesRepository,
  ImprintsRepository as SqlImprintsRepository,
  MemoryRepository as SqlMemoryRepository,
  ConversationsRepository as SqlConversationsRepository,
  WorkspaceItemsRepository as SqlWorkspaceItemsRepository,
} from '../storage/sqlite/repositories';
import {
  AccountsRepository as AccountsContract,
  PromptsRepository as PromptsContract,
  AgentsRepository as AgentsContract,
  DirectorsRepository as DirectorsContract,
  FiltersRepository as FiltersContract,
  TemplatesRepository as TemplatesContract,
  ImprintsRepository as ImprintsContract,
  MemoryRepository as MemoryContract,
  ConversationsRepository as ConversationsContract,
  WorkspaceItemsRepository as WorkspaceItemsContract,
} from './core';

function ensureId(entityName: string, id: unknown): asserts id is string {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error(`${entityName}: id is required`);
  }
}

function ensureArray<T>(entityName: string, field: string, value: T[]): asserts value is T[] {
  if (!Array.isArray(value)) {
    throw new Error(`${entityName}: ${field} must be an array`);
  }
}

async function listAll<T>(repo: { getAll(): Promise<T[]> }): Promise<readonly T[]> {
  const items = await repo.getAll();
  return items.slice();
}

type LegacyListRepo<T> = {
  getAll(): Promise<T[]>;
  setAll(next: T[]): Promise<void>;
};

type LegacyReplaceRepo<T> = LegacyListRepo<T>;

type BasicCrud<T> = {
  list(): Promise<readonly T[]>;
  getById(id: string): Promise<T | null>;
  insert(item: T): Promise<void>;
  update(item: T): Promise<void>;
  delete(id: string): Promise<boolean>;
};

function attachBasicCrud<T extends { id: string }, R extends LegacyListRepo<T>>(
  repo: R,
  entityName: string
): R & BasicCrud<T> {
  const target = repo as R & Partial<BasicCrud<T>>;
  if (!target.list) {
    target.list = async () => listAll(repo);
  }
  if (!target.getById) {
    target.getById = async (id: string) => {
      ensureId(entityName, id);
      const all = await repo.getAll();
      return all.find((item) => item.id === id) ?? null;
    };
  }
  if (!target.insert) {
    target.insert = async (item: T) => {
      ensureId(entityName, item?.id);
      const all = await repo.getAll();
      if (all.some((existing) => existing.id === item.id)) {
        throw new Error(`${entityName}: duplicate id '${item.id}'`);
      }
      const next = [...all, item];
      await repo.setAll(next);
    };
  }
  if (!target.update) {
    target.update = async (item: T) => {
      ensureId(entityName, item?.id);
      const all = await repo.getAll();
      const idx = all.findIndex((existing) => existing.id === item.id);
      if (idx === -1) {
        throw new Error(`${entityName}: id '${item.id}' not found`);
      }
      const next = all.slice();
      next[idx] = item;
      await repo.setAll(next);
    };
  }
  if (!target.delete) {
    target.delete = async (id: string) => {
      ensureId(entityName, id);
      const all = await repo.getAll();
      const next = all.filter((item) => item.id !== id);
      if (next.length === all.length) {
        return false;
      }
      await repo.setAll(next);
      return true;
    };
  }
  return target as R & BasicCrud<T>;
}

export type AccountsRepoInstance = SqlAccountsRepository & AccountsContract;

export function augmentAccountsRepository(repo: SqlAccountsRepository): AccountsRepoInstance {
  const candidate = repo as unknown as Partial<AccountsContract>;
  if (
    typeof candidate.list === 'function' &&
    typeof candidate.getById === 'function' &&
    typeof candidate.insert === 'function' &&
    typeof candidate.update === 'function' &&
    typeof candidate.delete === 'function'
  ) {
    return repo as AccountsRepoInstance;
  }
  const legacy = repo as unknown as LegacyListRepo<Account>;
  return attachBasicCrud<Account, typeof legacy>(legacy, 'Account') as unknown as AccountsRepoInstance;
}

export type PromptsRepoInstance = SqlPromptsRepository & PromptsContract & BasicCrud<Prompt>;

export function augmentPromptsRepository(repo: SqlPromptsRepository): PromptsRepoInstance {
  return attachBasicCrud<Prompt, SqlPromptsRepository>(repo, 'Prompt') as PromptsRepoInstance;
}

export type AgentsRepoInstance = SqlAgentsRepository & AgentsContract & BasicCrud<Agent>;

export function augmentAgentsRepository(repo: SqlAgentsRepository): AgentsRepoInstance {
  return attachBasicCrud<Agent, SqlAgentsRepository>(repo, 'Agent') as AgentsRepoInstance;
}

export type DirectorsRepoInstance = SqlDirectorsRepository & DirectorsContract & BasicCrud<Director>;

export function augmentDirectorsRepository(repo: SqlDirectorsRepository): DirectorsRepoInstance {
  return attachBasicCrud<Director, SqlDirectorsRepository>(repo, 'Director') as DirectorsRepoInstance;
}

export type TemplatesRepoInstance = SqlTemplatesRepository & TemplatesContract & BasicCrud<TemplateItem>;

export function augmentTemplatesRepository(repo: SqlTemplatesRepository): TemplatesRepoInstance {
  return attachBasicCrud<TemplateItem, SqlTemplatesRepository>(repo, 'Template') as TemplatesRepoInstance;
}

export type ImprintsRepoInstance = SqlImprintsRepository & ImprintsContract & BasicCrud<Imprint>;

export function augmentImprintsRepository(repo: SqlImprintsRepository): ImprintsRepoInstance {
  return attachBasicCrud<Imprint, SqlImprintsRepository>(repo, 'Imprint') as ImprintsRepoInstance;
}

export type FiltersRepoInstance = SqlFiltersRepository & FiltersContract & BasicCrud<Filter>;

export function augmentFiltersRepository(repo: SqlFiltersRepository): FiltersRepoInstance {
  const target = attachBasicCrud<Filter, SqlFiltersRepository>(repo, 'Filter') as FiltersRepoInstance;
  target.reorder = async (orderedIds: readonly string[]) => {
    const all = await repo.getAll();
    const byId = new Map(all.map((item) => [item.id, item] as const));
    const reordered: Filter[] = [];
    for (const id of orderedIds) {
      ensureId('Filter', id);
      const item = byId.get(id);
      if (item) reordered.push(item);
    }
    for (const item of all) {
      if (!orderedIds.includes(item.id)) {
        reordered.push(item);
      }
    }
    await repo.setAll(reordered);
  };
  return target;
}

export type MemoryRepoInstance = SqlMemoryRepository & MemoryContract;

export function augmentMemoryRepository(repo: SqlMemoryRepository): MemoryRepoInstance {
  return Object.assign(repo, {
    list: async () => listAll(repo),
    findById: async (id: string) => {
      ensureId('Memory', id);
      const all = await repo.getAll();
      return all.find((entry) => entry.id === id) ?? null;
    },
    insert: async (entry: MemoryEntry) => {
      ensureId('Memory', entry?.id);
      await repo.mutate((current) => {
        if (current.some((existing) => existing.id === entry.id)) {
          throw new Error(`Memory: duplicate id '${entry.id}'`);
        }
        return [...current, entry];
      });
    },
    update: async (entry: MemoryEntry) => {
      ensureId('Memory', entry?.id);
      await repo.mutate((current) => {
        const idx = current.findIndex((existing) => existing.id === entry.id);
        if (idx === -1) {
          throw new Error(`Memory: id '${entry.id}' not found`);
        }
        const next = current.slice();
        next[idx] = entry;
        return next;
      });
    },
    delete: async (id: string) => {
      ensureId('Memory', id);
      return await repo.deleteById(id);
    },
    deleteMany: async (ids: readonly string[]) => {
      ids.forEach((id) => ensureId('Memory', id));
      let removed = 0;
      await repo.mutate((current) => {
        const next = current.filter((entry) => {
          if (ids.includes(entry.id)) {
            removed += 1;
            return false;
          }
          return true;
        });
        return next;
      });
      return removed;
    },
  }) as MemoryRepoInstance;
}

function ensureThreadTimestamps(thread: ConversationThread, context: string): void {
  const { startedAt, lastActiveAt } = thread;
  if (typeof startedAt !== 'string' || !startedAt.trim()) {
    throw new Error(`${context}: startedAt missing for conversation ${thread.id}`);
  }
  if (typeof lastActiveAt !== 'string' || !lastActiveAt.trim()) {
    throw new Error(`${context}: lastActiveAt missing for conversation ${thread.id}`);
  }
  if (Number.isNaN(Date.parse(startedAt))) {
    throw new Error(`${context}: startedAt invalid for conversation ${thread.id}`);
  }
  if (Number.isNaN(Date.parse(lastActiveAt))) {
    throw new Error(`${context}: lastActiveAt invalid for conversation ${thread.id}`);
  }
}

function cloneThread(thread: ConversationThread): ConversationThread {
  return JSON.parse(JSON.stringify(thread)) as ConversationThread;
}

export type ConversationsRepoInstance = SqlConversationsRepository & ConversationsContract;

export function augmentConversationsRepository(repo: SqlConversationsRepository): ConversationsRepoInstance {
  return Object.assign(repo, {
    list: async () => listAll(repo),
    getById: async (id: string) => {
      ensureId('Conversation', id);
      const all = await repo.getAll();
      return all.find((thread) => thread.id === id) ?? null;
    },
    insert: async (thread: ConversationThread) => {
      ensureId('Conversation', thread?.id);
      ensureThreadTimestamps(thread, 'insert');
      await repo.mutate((current) => {
        if (current.some((existing) => existing.id === thread.id)) {
          throw new Error(`Conversation: duplicate id '${thread.id}'`);
        }
        return [...current, cloneThread(thread)];
      });
    },
    update: async (thread: ConversationThread) => {
      ensureId('Conversation', thread?.id);
      ensureThreadTimestamps(thread, 'update');
      await repo.mutate((current) => {
        const idx = current.findIndex((existing) => existing.id === thread.id);
        if (idx === -1) {
          throw new Error(`Conversation: id '${thread.id}' not found`);
        }
        const next = current.slice();
        next[idx] = cloneThread(thread);
        return next;
      });
    },
    appendMessages: async (threadId: string, messages: readonly PromptMessage[]) => {
      ensureId('Conversation', threadId);
      ensureArray<PromptMessage>('Conversation', 'messages', messages as PromptMessage[]);
      if (messages.length === 0) {
        throw new Error('Conversation: appendMessages requires non-empty messages array');
      }
      let updated: ConversationThread | null = null;
      await repo.mutate((current) => {
        const idx = current.findIndex((existing) => existing.id === threadId);
        if (idx === -1) {
          return current;
        }
        const now = new Date().toISOString();
        const base = cloneThread(current[idx]);
        ensureThreadTimestamps(base, 'appendMessages');
        const nextThread: ConversationThread = {
          ...base,
          lastActiveAt: now,
          messages: [...base.messages, ...messages],
        } as ConversationThread;
        const next = current.slice();
        next[idx] = nextThread;
        updated = nextThread;
        return next;
      });
      return updated;
    },
    finalizeStatus: async (threadId: string, status: 'completed' | 'failed', timestamp: string) => {
      ensureId('Conversation', threadId);
      if (typeof timestamp !== 'string' || !timestamp.trim()) {
        throw new Error('Conversation: finalizeStatus requires timestamp');
      }
      let updated: ConversationThread | null = null;
      await repo.mutate((current) => {
        const idx = current.findIndex((existing) => existing.id === threadId);
        if (idx === -1) {
          return current;
        }
        const base = cloneThread(current[idx]);
        ensureThreadTimestamps(base, 'finalizeStatus');
        const nextThread: ConversationThread = {
          ...base,
          status,
          endedAt: timestamp,
          lastActiveAt: timestamp,
        } as ConversationThread;
        const next = current.slice();
        next[idx] = nextThread;
        updated = nextThread;
        return next;
      });
      return updated;
    },
    delete: async (id: string) => {
      ensureId('Conversation', id);
      let removed = false;
      await repo.mutate((current) => {
        const next = current.filter((thread) => {
          if (thread.id === id) {
            removed = true;
            return false;
          }
          return true;
        });
        return next;
      });
      return removed;
    },
  }) as ConversationsRepoInstance;
}

export type WorkspaceItemsRepoInstance = SqlWorkspaceItemsRepository & WorkspaceItemsContract & LegacyReplaceRepo<WorkspaceItem>;

export function augmentWorkspaceItemsRepository(repo: SqlWorkspaceItemsRepository): WorkspaceItemsRepoInstance {
  return Object.assign(repo, {
    list: async () => listAll(repo),
    listByConversation: async (conversationId: string) => {
      ensureId('WorkspaceItem', conversationId);
      return await repo.getByConversation(conversationId);
    },
    insert: async (item: WorkspaceItem) => {
      ensureId('WorkspaceItem', item?.id);
      const all = await repo.getAll();
      if (all.some((existing) => existing.id === item.id)) {
        throw new Error(`WorkspaceItem: duplicate id '${item.id}'`);
      }
      await repo.setAll([...all, item]);
    },
    update: async (item: WorkspaceItem) => {
      ensureId('WorkspaceItem', item?.id);
      const all = await repo.getAll();
      const idx = all.findIndex((existing) => existing.id === item.id);
      if (idx === -1) {
        throw new Error(`WorkspaceItem: id '${item.id}' not found`);
      }
      const next = all.slice();
      next[idx] = item;
      await repo.setAll(next);
    },
    delete: async (id: string) => {
      ensureId('WorkspaceItem', id);
      const all = await repo.getAll();
      const next = all.filter((existing) => existing.id !== id);
      if (next.length === all.length) {
        return false;
      }
      await repo.setAll(next);
      return true;
    },
    deleteByConversation: async (conversationId: string) => {
      ensureId('WorkspaceItem', conversationId);
      const existing = await repo.getByConversation(conversationId);
      await repo.replaceForConversation(conversationId, []);
      return existing.length;
    },
  }) as WorkspaceItemsRepoInstance;
}
