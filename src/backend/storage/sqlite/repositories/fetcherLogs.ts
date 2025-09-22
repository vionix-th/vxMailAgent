import type { FetcherLogEntry } from '../../../../shared/types';
import { FETCHER_TTL_DAYS, USER_MAX_LOGS_PER_TYPE } from '../../../config';
import type { StorageHandle } from '../types';
import { SqliteRepository, stringify } from './base';

function ensureLogString(value: unknown, field: string, id: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`fetcher log ${id}: ${field} missing`);
  }
  return value;
}

function pruneFetcherLogs(db: any) {
  if (FETCHER_TTL_DAYS > 0) {
    db.prepare('DELETE FROM fetcher_logs WHERE timestamp < datetime("now", ?)')
      .run(`-${FETCHER_TTL_DAYS} days`);
  }
  if (USER_MAX_LOGS_PER_TYPE > 0) {
    const total = db.prepare('SELECT COUNT(*) AS c FROM fetcher_logs').get()?.c as number;
    if (typeof total === 'number' && total > USER_MAX_LOGS_PER_TYPE) {
      const excess = total - USER_MAX_LOGS_PER_TYPE;
      db.prepare(`
        DELETE FROM fetcher_logs
        WHERE id IN (
          SELECT id FROM fetcher_logs
          ORDER BY timestamp ASC
          LIMIT ?
        )
      `).run(excess);
    }
  }
}

export class FetcherLogRepository extends SqliteRepository {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async getAll(): Promise<FetcherLogEntry[]> {
    return this.withConnection((db) => {
      const rows = db.prepare(
        'SELECT id, timestamp, level, provider, account_id, event, email_id, count, detail_json FROM fetcher_logs ORDER BY timestamp'
      ).all();
      return rows.map((row: any) => {
        if (!row.account_id) {
          throw new Error(`fetcher log missing account_id (id=${row.id})`);
        }
        const provider = ensureLogString(row.provider, 'provider', row.id);
        const emailId = ensureLogString(row.email_id, 'email_id', row.id);
        return {
          id: row.id,
          timestamp: row.timestamp,
          level: row.level,
          provider,
          accountId: row.account_id,
          event: row.event,
          emailId,
          count: typeof row.count === 'number' ? row.count : undefined,
          detail: row.detail_json ? JSON.parse(row.detail_json) : undefined,
        };
      });
    });
  }

  async setAll(entries: FetcherLogEntry[]): Promise<void> {
    await this.transaction((db) => {
      db.prepare('DELETE FROM fetcher_logs').run();
      const insert = db.prepare(
        'INSERT INTO fetcher_logs (id, timestamp, level, provider, account_id, event, email_id, count, detail_json) VALUES (@id, @timestamp, @level, @provider, @account_id, @event, @email_id, @count, @detail_json)'
      );
      for (const entry of entries) {
        const provider = ensureLogString(entry.provider, 'provider', entry.id);
        const emailId = ensureLogString(entry.emailId, 'emailId', entry.id);
        insert.run({
          id: entry.id,
          timestamp: entry.timestamp,
          level: entry.level,
          provider,
          account_id: entry.accountId,
          event: entry.event,
          email_id: emailId,
          count: typeof entry.count === 'number' ? entry.count : null,
          detail_json: entry.detail ? stringify(entry.detail) : null,
        });
      }
      pruneFetcherLogs(db);
      return undefined;
    });
  }

  async append(entry: FetcherLogEntry): Promise<void> {
    await this.transaction((db) => {
      const provider = ensureLogString(entry.provider, 'provider', entry.id);
      const emailId = ensureLogString(entry.emailId, 'emailId', entry.id);
      db.prepare(
        'INSERT INTO fetcher_logs (id, timestamp, level, provider, account_id, event, email_id, count, detail_json) VALUES (@id, @timestamp, @level, @provider, @account_id, @event, @email_id, @count, @detail_json)'
      ).run({
        id: entry.id,
        timestamp: entry.timestamp,
        level: entry.level,
        provider,
        account_id: entry.accountId,
        event: entry.event,
        email_id: emailId,
        count: typeof entry.count === 'number' ? entry.count : null,
        detail_json: entry.detail ? stringify(entry.detail) : null,
      });
      pruneFetcherLogs(db);
      return undefined;
    });
  }
}
