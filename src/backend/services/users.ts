import { Repository } from '../repository/core';
import { User } from '../../shared/types';

let usersRepo: Repository<User> | null = null;

export function setUsersRepo(repo: Repository<User>) {
  usersRepo = repo;
}

export function getUsersRepo(): Repository<User> {
  if (!usersRepo) throw new Error('Users repository not initialized');
  return usersRepo;
}

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

export function findUserById(id: string): User | undefined {
  const repo = getUsersRepo();
  return repo.getAll().find(u => u.id === id);
}

export function findUserByEmail(email: string): User | undefined {
  const repo = getUsersRepo();
  return repo.getAll().find(u => u.email.toLowerCase() === email.toLowerCase());
}
