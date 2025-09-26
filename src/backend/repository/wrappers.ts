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

function assertMethods(repo: any, entity: string, methods: readonly string[]): void {
  const missing = methods.filter((method) => typeof repo[method] !== 'function');
  if (missing.length) {
    throw new Error(`${entity}: missing contract methods (${missing.join(', ')})`);
  }
}

export type AccountsRepoInstance = SqlAccountsRepository & AccountsContract;

export function augmentAccountsRepository(repo: SqlAccountsRepository): AccountsRepoInstance {
  assertMethods(repo, 'AccountsRepository', ['list', 'getById', 'insert', 'update', 'updateTokens', 'delete']);
  return repo as AccountsRepoInstance;
}

export type PromptsRepoInstance = SqlPromptsRepository & PromptsContract;

export function augmentPromptsRepository(repo: SqlPromptsRepository): PromptsRepoInstance {
  assertMethods(repo, 'PromptsRepository', ['list', 'getById', 'insert', 'update', 'delete']);
  return repo as PromptsRepoInstance;
}

export type AgentsRepoInstance = SqlAgentsRepository & AgentsContract;

export function augmentAgentsRepository(repo: SqlAgentsRepository): AgentsRepoInstance {
  assertMethods(repo, 'AgentsRepository', ['list', 'getById', 'insert', 'update', 'delete']);
  return repo as AgentsRepoInstance;
}

export type DirectorsRepoInstance = SqlDirectorsRepository & DirectorsContract;

export function augmentDirectorsRepository(repo: SqlDirectorsRepository): DirectorsRepoInstance {
  assertMethods(repo, 'DirectorsRepository', ['list', 'getById', 'insert', 'update', 'delete']);
  return repo as DirectorsRepoInstance;
}

export type TemplatesRepoInstance = SqlTemplatesRepository & TemplatesContract;

export function augmentTemplatesRepository(repo: SqlTemplatesRepository): TemplatesRepoInstance {
  assertMethods(repo, 'TemplatesRepository', ['list', 'getById', 'insert', 'update', 'delete']);
  return repo as TemplatesRepoInstance;
}

export type ImprintsRepoInstance = SqlImprintsRepository & ImprintsContract;

export function augmentImprintsRepository(repo: SqlImprintsRepository): ImprintsRepoInstance {
  assertMethods(repo, 'ImprintsRepository', ['list', 'getById', 'insert', 'update', 'delete']);
  return repo as ImprintsRepoInstance;
}

export type FiltersRepoInstance = SqlFiltersRepository & FiltersContract;

export function augmentFiltersRepository(repo: SqlFiltersRepository): FiltersRepoInstance {
  assertMethods(repo, 'FiltersRepository', ['list', 'getById', 'insert', 'update', 'delete', 'reorder']);
  return repo as FiltersRepoInstance;
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
