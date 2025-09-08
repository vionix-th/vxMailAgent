import { Repository } from '../repository/core';
import { User } from '../../shared/types';

let userAccountsRepo: Repository<User> | null = null;

/** Inject the repository used for user accounts persistence. */
export function setUserAccountsRepo(repo: Repository<User>) {
  userAccountsRepo = repo;
}

/** Retrieve the configured user accounts repository. */
export function getUserAccountsRepo(): Repository<User> {
  if (!userAccountsRepo) throw new Error('User accounts repository not initialized');
  return userAccountsRepo;
}

/** Insert or update a user record. */
export async function upsertUser(next: User): Promise<User> {
  const repo = getUserAccountsRepo();
  const all = await repo.getAll();
  const idx = all.findIndex(u => u.id === next.id);
  if (idx >= 0) {
    const cur = all[idx];
    all[idx] = { ...next, createdAt: cur.createdAt || next.createdAt };
  } else {
    all.push(next);
  }
  await repo.setAll(all);
  return next;
}

/** Find a user by identifier. */
export async function findUserById(id: string): Promise<User | undefined> {
  const repo = getUserAccountsRepo();
  const all = await repo.getAll();
  return all.find(u => u.id === id);
}

/** Find a user by email address (case-insensitive). */
export async function findUserByEmail(email: string): Promise<User | undefined> {
  const repo = getUserAccountsRepo();
  const all = await repo.getAll();
  return all.find(u => u.email.toLowerCase() === email.toLowerCase());
}
