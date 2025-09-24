import type { User } from '../../../../shared/types';
import type { StorageHandle } from '../types';
import { SqliteRepository } from './base';
import type { SystemUsersRepository as SystemUsersRepositoryContract } from '../../../repository/core';

export class SystemUsersRepository
  extends SqliteRepository
  implements SystemUsersRepositoryContract
{
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async list(): Promise<readonly User[]> {
    return this.withConnection((db) => {
      const rows = db.prepare(
        'SELECT id, email, name, picture, created_at, last_login_at FROM users ORDER BY created_at'
      ).all();
      return rows.map((row: any) => this.mapRow(row));
    });
  }

  async findById(id: string): Promise<User | null> {
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error('SystemUsersRepository.findById requires non-empty id');
    }
    return this.withConnection((db) => {
      const row = db
        .prepare(
          'SELECT id, email, name, picture, created_at, last_login_at FROM users WHERE id = ?'
        )
        .get(id);
      return row ? this.mapRow(row) : null;
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    if (typeof email !== 'string' || !email.trim()) {
      throw new Error('SystemUsersRepository.findByEmail requires non-empty email');
    }
    return this.withConnection((db) => {
      const row = db
        .prepare(
          'SELECT id, email, name, picture, created_at, last_login_at FROM users WHERE lower(email) = lower(?)'
        )
        .get(email);
      return row ? this.mapRow(row) : null;
    });
  }

  async upsert(user: User): Promise<User> {
    this.assertUser(user);
    return this.transaction((db) => {
      db.prepare(
        `INSERT INTO users (id, email, name, picture, created_at, last_login_at)
         VALUES (@id, @email, @name, @picture, @created_at, @last_login_at)
         ON CONFLICT(id) DO UPDATE SET
           email = excluded.email,
           name = excluded.name,
           picture = excluded.picture,
           created_at = excluded.created_at,
           last_login_at = excluded.last_login_at`
      ).run({
        id: user.id,
        email: user.email,
        name: user.name ?? null,
        picture: user.picture ?? null,
        created_at: user.createdAt,
        last_login_at: user.lastLoginAt,
      });
      return user;
    });
  }

  async delete(id: string): Promise<boolean> {
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error('SystemUsersRepository.delete requires non-empty id');
    }
    return this.transaction((db) => {
      const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
      return result.changes > 0;
    });
  }

  private mapRow(row: any): User {
    return {
      id: row.id,
      email: row.email,
      name: row.name === null ? undefined : row.name,
      picture: row.picture === null ? undefined : row.picture,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
    };
  }

  private assertUser(user: User): void {
    if (typeof user?.id !== 'string' || !user.id.trim()) {
      throw new Error('SystemUsersRepository.upsert requires user.id');
    }
    if (typeof user.email !== 'string' || !user.email.trim()) {
      throw new Error('SystemUsersRepository.upsert requires user.email');
    }
    if (typeof user.createdAt !== 'string' || !user.createdAt.trim()) {
      throw new Error('SystemUsersRepository.upsert requires user.createdAt');
    }
    if (typeof user.lastLoginAt !== 'string' || !user.lastLoginAt.trim()) {
      throw new Error('SystemUsersRepository.upsert requires user.lastLoginAt');
    }
  }
}
