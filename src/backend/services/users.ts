import type { SystemUsersRepository } from '../repository/core';
import type { User } from '../../shared/types';

let userAccountsRepo: SystemUsersRepository | null = null;

/** Inject the repository used for user accounts persistence. */
export function setUserAccountsRepo(repo: SystemUsersRepository) {
  userAccountsRepo = repo;
}

/** Retrieve the configured user accounts repository. */
export function getUserAccountsRepo(): SystemUsersRepository {
  if (!userAccountsRepo) throw new Error('User accounts repository not initialized');
  return userAccountsRepo;
}

/** Insert or update a user record. */
export async function upsertUser(next: User): Promise<User> {
  const repo = getUserAccountsRepo();
  return await repo.upsert(next);
}

/** Find a user by identifier. */
export async function findUserById(id: string): Promise<User | undefined> {
  const repo = getUserAccountsRepo();
  const result = await repo.findById(id);
  return result ?? undefined;
}

/** Find a user by email address (case-insensitive). */
export async function findUserByEmail(email: string): Promise<User | undefined> {
  const repo = getUserAccountsRepo();
  const result = await repo.findByEmail(email);
  return result ?? undefined;
}
