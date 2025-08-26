import { Repository } from '../repository/core';
import { User } from '../../shared/types';

let usersRepo: Repository<User> | null = null;

/** Inject the repository used for user persistence. */
export function setUsersRepo(repo: Repository<User>) {
  usersRepo = repo;
}

/** Retrieve the configured users repository. */
export function getUsersRepo(): Repository<User> {
  if (!usersRepo) throw new Error('Users repository not initialized');
  return usersRepo;
}

/** Insert or update a user record. */
export function upsertUser(next: User): User {
  const repo = getUsersRepo();
  const all = repo.getAll();
  const idx = all.findIndex(u => u.id === next.id);
  if (idx >= 0) {
    const cur = all[idx];
    all[idx] = { ...next, createdAt: cur.createdAt || next.createdAt };
  } else {
    all.push(next);
  }
  repo.setAll(all);
  return next;
}

/** Find a user by identifier. */
export function findUserById(id: string): User | undefined {
  const repo = getUsersRepo();
  return repo.getAll().find(u => u.id === id);
}

/** Find a user by email address (case-insensitive). */
export function findUserByEmail(email: string): User | undefined {
  const repo = getUsersRepo();
  return repo.getAll().find(u => u.email.toLowerCase() === email.toLowerCase());
}
