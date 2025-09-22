import type { Account } from '../../../../shared/types';
import type { StorageHandle } from '../types';
import { SqliteRepository, stringify } from './base';

export class AccountsRepository extends SqliteRepository {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async getAll(): Promise<Account[]> {
    return this.withConnection((db) => {
      const rows = db.prepare(
        'SELECT id, provider, email, signature, tokens_json FROM accounts ORDER BY email'
      ).all();
      return rows.map((row: any) => ({
        id: row.id,
        provider: row.provider,
        email: row.email,
        signature: row.signature,
        tokens: JSON.parse(row.tokens_json),
      })) as Account[];
    });
  }

  async setAll(accounts: Account[]): Promise<void> {
    await this.transaction((db) => {
      db.prepare('DELETE FROM accounts').run();
      const insert = db.prepare(
        'INSERT INTO accounts (id, provider, email, signature, tokens_json, updated_at) VALUES (@id, @provider, @email, @signature, @tokens_json, @updated_at)'
      );
      const now = new Date().toISOString();
      for (const account of accounts) {
        insert.run({
          id: account.id,
          provider: account.provider,
          email: account.email,
          signature: account.signature,
          tokens_json: stringify(account.tokens),
          updated_at: now,
        });
      }
      return undefined;
    });
  }
}
