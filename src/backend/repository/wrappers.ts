import type {
  Account,
  Agent,
  Director,
  Filter,
  Imprint,
  Prompt,
  TemplateItem,
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

async function listAll<T>(repo: { getAll(): Promise<T[]> }): Promise<readonly T[]> {
  const items = await repo.getAll();
  return items.slice();
}

type LegacyListRepo<T> = {
  getAll(): Promise<T[]>;
  setAll(next: T[]): Promise<void>;
};

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

export type PromptsRepoInstance = SqlPromptsRepository & PromptsContract;

export function augmentPromptsRepository(repo: SqlPromptsRepository): PromptsRepoInstance {
  const candidate = repo as unknown as Partial<PromptsContract>;
  if (
    typeof candidate.list === 'function' &&
    typeof candidate.getById === 'function' &&
    typeof candidate.insert === 'function' &&
    typeof candidate.update === 'function' &&
    typeof candidate.delete === 'function'
  ) {
    return repo as PromptsRepoInstance;
  }
  const legacy = repo as unknown as LegacyListRepo<Prompt>;
  return attachBasicCrud<Prompt, typeof legacy>(legacy, 'Prompt') as unknown as PromptsRepoInstance;
}

export type AgentsRepoInstance = SqlAgentsRepository & AgentsContract;

export function augmentAgentsRepository(repo: SqlAgentsRepository): AgentsRepoInstance {
  const candidate = repo as unknown as Partial<AgentsContract>;
  if (
    typeof candidate.list === 'function' &&
    typeof candidate.getById === 'function' &&
    typeof candidate.insert === 'function' &&
    typeof candidate.update === 'function' &&
    typeof candidate.delete === 'function'
  ) {
    return repo as AgentsRepoInstance;
  }
  const legacy = repo as unknown as LegacyListRepo<Agent>;
  return attachBasicCrud<Agent, typeof legacy>(legacy, 'Agent') as unknown as AgentsRepoInstance;
}

export type DirectorsRepoInstance = SqlDirectorsRepository & DirectorsContract;

export function augmentDirectorsRepository(repo: SqlDirectorsRepository): DirectorsRepoInstance {
  const candidate = repo as unknown as Partial<DirectorsContract>;
  if (
    typeof candidate.list === 'function' &&
    typeof candidate.getById === 'function' &&
    typeof candidate.insert === 'function' &&
    typeof candidate.update === 'function' &&
    typeof candidate.delete === 'function'
  ) {
    return repo as DirectorsRepoInstance;
  }
  const legacy = repo as unknown as LegacyListRepo<Director>;
  return attachBasicCrud<Director, typeof legacy>(legacy, 'Director') as unknown as DirectorsRepoInstance;
}

export type TemplatesRepoInstance = SqlTemplatesRepository & TemplatesContract;

export function augmentTemplatesRepository(repo: SqlTemplatesRepository): TemplatesRepoInstance {
  const candidate = repo as unknown as Partial<TemplatesContract>;
  if (
    typeof candidate.list === 'function' &&
    typeof candidate.getById === 'function' &&
    typeof candidate.insert === 'function' &&
    typeof candidate.update === 'function' &&
    typeof candidate.delete === 'function'
  ) {
    return repo as TemplatesRepoInstance;
  }
  const legacy = repo as unknown as LegacyListRepo<TemplateItem>;
  return attachBasicCrud<TemplateItem, typeof legacy>(legacy, 'Template') as unknown as TemplatesRepoInstance;
}

export type ImprintsRepoInstance = SqlImprintsRepository & ImprintsContract & BasicCrud<Imprint>;

export function augmentImprintsRepository(repo: SqlImprintsRepository): ImprintsRepoInstance {
  return attachBasicCrud<Imprint, SqlImprintsRepository>(repo, 'Imprint') as ImprintsRepoInstance;
}

export type FiltersRepoInstance = SqlFiltersRepository & FiltersContract;

export function augmentFiltersRepository(repo: SqlFiltersRepository): FiltersRepoInstance {
  const candidate = repo as unknown as Partial<FiltersContract>;
  if (
    typeof candidate.list === 'function' &&
    typeof candidate.getById === 'function' &&
    typeof candidate.insert === 'function' &&
    typeof candidate.update === 'function' &&
    typeof candidate.delete === 'function' &&
    typeof candidate.reorder === 'function'
  ) {
    return repo as FiltersRepoInstance;
  }
  const legacy = repo as unknown as LegacyListRepo<Filter>;
  const target = attachBasicCrud<Filter, typeof legacy>(legacy, 'Filter') as unknown as FiltersRepoInstance;
  target.reorder = async (orderedIds: readonly string[]) => {
    const all = await legacy.getAll();
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
    await legacy.setAll(reordered);
  };
  return target;
}

export type MemoryRepoInstance = SqlMemoryRepository & MemoryContract;

function assertMemoryRepositoryContract(repo: SqlMemoryRepository): asserts repo is MemoryRepoInstance {
  const missing = [] as string[];
  if (typeof repo.list !== 'function') missing.push('list');
  if (typeof repo.findById !== 'function') missing.push('findById');
  if (typeof repo.insert !== 'function') missing.push('insert');
  if (typeof repo.update !== 'function') missing.push('update');
  if (typeof repo.delete !== 'function') missing.push('delete');
  if (typeof repo.deleteMany !== 'function') missing.push('deleteMany');
  if (missing.length) {
    throw new Error(`MemoryRepository: missing contract methods (${missing.join(', ')})`);
  }
}

export function augmentMemoryRepository(repo: SqlMemoryRepository): MemoryRepoInstance {
  assertMemoryRepositoryContract(repo);
  return repo;
}

export type ConversationsRepoInstance = SqlConversationsRepository & ConversationsContract;

function assertConversationsRepositoryContract(repo: SqlConversationsRepository): asserts repo is ConversationsRepoInstance {
  const missing = [] as string[];
  if (typeof repo.list !== 'function') missing.push('list');
  if (typeof repo.getById !== 'function') missing.push('getById');
  if (typeof repo.insert !== 'function') missing.push('insert');
  if (typeof repo.update !== 'function') missing.push('update');
  if (typeof repo.appendMessages !== 'function') missing.push('appendMessages');
  if (typeof repo.finalizeStatus !== 'function') missing.push('finalizeStatus');
  if (typeof repo.delete !== 'function') missing.push('delete');
  if (missing.length) {
    throw new Error(`ConversationsRepository: missing contract methods (${missing.join(', ')})`);
  }
}

export function augmentConversationsRepository(repo: SqlConversationsRepository): ConversationsRepoInstance {
  assertConversationsRepositoryContract(repo);
  return repo;
}

export type WorkspaceItemsRepoInstance = SqlWorkspaceItemsRepository & WorkspaceItemsContract;

function assertWorkspaceItemsRepositoryContract(
  repo: SqlWorkspaceItemsRepository
): asserts repo is WorkspaceItemsRepoInstance {
  const missing = [] as string[];
  if (typeof repo.list !== 'function') missing.push('list');
  if (typeof repo.listByConversation !== 'function') missing.push('listByConversation');
  if (typeof repo.insert !== 'function') missing.push('insert');
  if (typeof repo.update !== 'function') missing.push('update');
  if (typeof repo.delete !== 'function') missing.push('delete');
  if (typeof repo.deleteByConversation !== 'function') missing.push('deleteByConversation');
  if (missing.length) {
    throw new Error(`WorkspaceItemsRepository: missing contract methods (${missing.join(', ')})`);
  }
}

export function augmentWorkspaceItemsRepository(repo: SqlWorkspaceItemsRepository): WorkspaceItemsRepoInstance {
  assertWorkspaceItemsRepositoryContract(repo);
  return repo;
}
