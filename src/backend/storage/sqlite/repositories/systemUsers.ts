import type { User } from '../../../../shared/types';
import type { StorageHandle } from '../types';
import { SqliteRepository } from './base';
import type { Repository } from '../../../repository/core';

export class SystemUsersRepository extends SqliteRepository implements Repository<User> {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async getAll(): Promise<User[]> {
    return this.withConnection((db) => {
      const rows = db.prepare(
        'SELECT id, email, name, picture, created_at, last_login_at FROM users ORDER BY created_at'
      ).all();
      return rows.map((row: any) => ({
        id: row.id,
        email: row.email,
        name: row.name === null ? undefined : row.name,
        picture: row.picture === null ? undefined : row.picture,
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at,
      }));
    });
  }

  async setAll(users: User[]): Promise<void> {
    await this.transaction((db) => {
      db.prepare('DELETE FROM users').run();
      const insert = db.prepare(
        'INSERT INTO users (id, email, name, picture, created_at, last_login_at) VALUES (@id, @email, @name, @picture, @created_at, @last_login_at)'
      );
      for (const user of users) {
        insert.run({
          id: user.id,
          email: user.email,
          name: user.name ?? null,
          picture: user.picture ?? null,
          created_at: user.createdAt,
          last_login_at: user.lastLoginAt,
        });
      }
      return undefined;
    });
  }
}
