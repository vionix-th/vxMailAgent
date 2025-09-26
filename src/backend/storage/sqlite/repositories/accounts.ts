import type { Account } from '../../../../shared/types';
import { createAccount } from '../../../../shared/constructors';
import type { StorageHandle } from '../types';
import { SqliteRepository, stringify } from './base';

export class AccountsRepository extends SqliteRepository {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async list(): Promise<readonly Account[]> {
    return this.withConnection((db) => {
      const rows = db.prepare(
        'SELECT id, provider, email, signature, tokens_json FROM accounts ORDER BY email'
      ).all();
      return rows.map((row: any) => this.mapRow(row));
    });
  }

  async getById(id: string): Promise<Account | null> {
    this.assertId(id);
    return this.withConnection((db) => {
      const row = db
        .prepare(
          'SELECT id, provider, email, signature, tokens_json FROM accounts WHERE id = ?'
        )
        .get(id);
      return row ? this.mapRow(row) : null;
    });
  }

  async insert(account: Account): Promise<void> {
    this.assertAccount(account);
    await this.transaction((db) => {
      const existing = db
        .prepare('SELECT 1 FROM accounts WHERE id = ?')
        .get(account.id);
      if (existing) {
        throw new Error(`AccountsRepository: account '${account.id}' already exists`);
      }
      db.prepare(
        'INSERT INTO accounts (id, provider, email, signature, tokens_json, updated_at) VALUES (@id, @provider, @email, @signature, @tokens_json, @updated_at)'
      ).run({
        id: account.id,
        provider: account.provider,
        email: account.email,
        signature: account.signature,
        tokens_json: stringify(account.tokens),
        updated_at: new Date().toISOString(),
      });
    });
  }

  async update(account: Account): Promise<void> {
    this.assertAccount(account);
    await this.transaction((db) => {
      const result = db
        .prepare(
          'UPDATE accounts SET provider = @provider, email = @email, signature = @signature, tokens_json = @tokens_json, updated_at = @updated_at WHERE id = @id'
        )
        .run({
          id: account.id,
          provider: account.provider,
          email: account.email,
          signature: account.signature,
          tokens_json: stringify(account.tokens),
          updated_at: new Date().toISOString(),
        });
      if (result.changes === 0) {
        throw new Error(`AccountsRepository: account '${account.id}' not found`);
      }
    });
  }

  async updateTokens(id: string, tokens: Account['tokens']): Promise<Account> {
    this.assertId(id);
    this.assertTokens(tokens);
    return this.transaction((db) => {
      const updatedAt = new Date().toISOString();
      const result = db
        .prepare('UPDATE accounts SET tokens_json = @tokens_json, updated_at = @updated_at WHERE id = @id')
        .run({ id, tokens_json: stringify(tokens), updated_at: updatedAt });
      if (result.changes === 0) {
        throw new Error(`AccountsRepository: account '${id}' not found`);
      }
      const row = db
        .prepare('SELECT id, provider, email, signature, tokens_json FROM accounts WHERE id = ?')
        .get(id);
      if (!row) {
        throw new Error(`AccountsRepository: account '${id}' missing after token update`);
      }
      return this.mapRow(row);
    });
  }

  async delete(id: string): Promise<boolean> {
    this.assertId(id);
    return this.transaction((db) => {
      const result = db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
      return result.changes > 0;
    });
  }

  async getAll(): Promise<Account[]> {
    const rows = await this.list();
    return [...rows];
  }

  private mapRow(row: any): Account {
    return createAccount({
      id: row.id,
      provider: row.provider,
      email: row.email,
      signature: row.signature,
      tokens: JSON.parse(row.tokens_json),
    });
  }

  private assertId(id: unknown): asserts id is string {
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error('AccountsRepository: id is required');
    }
  }

  private assertAccount(account: Account): void {
    if (!account || typeof account !== 'object') {
      throw new Error('AccountsRepository: account payload required');
    }
    createAccount({
      id: account.id,
      provider: account.provider,
      email: account.email,
      signature: account.signature,
      tokens: account.tokens,
    });
  }

  private assertTokens(tokens: Account['tokens']): void {
    if (!tokens || typeof tokens !== 'object') {
      throw new Error('AccountsRepository: tokens payload required');
    }
    const { accessToken, refreshToken, expiry } = tokens as any;
    if (typeof accessToken !== 'string' || !accessToken.trim()) {
      throw new Error('AccountsRepository: accessToken required');
    }
    if (typeof refreshToken !== 'string' || !refreshToken.trim()) {
      throw new Error('AccountsRepository: refreshToken required');
    }
    if (typeof expiry !== 'string' || !expiry.trim()) {
      throw new Error('AccountsRepository: expiry required');
    }
  }
}
