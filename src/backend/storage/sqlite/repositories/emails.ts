import type { EmailEnvelope } from '../../../../shared/types';
import type { StorageHandle } from '../types';
import { SqliteRepository, stringify } from './base';

export class EmailsRepository extends SqliteRepository {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async list(): Promise<readonly EmailEnvelope[]> {
    return this.withConnection((db) => {
      const rows = db.prepare('SELECT envelope_json FROM emails ORDER BY date_iso').all() as Array<{ envelope_json: string }>;
      return rows.map((row) => this.deserialize(row.envelope_json));
    });
  }

  async listPage(offset: number, limit: number): Promise<readonly EmailEnvelope[]> {
    return this.withConnection((db) => {
      const rows = db
        .prepare('SELECT envelope_json FROM emails ORDER BY date_iso LIMIT ? OFFSET ?')
        .all(limit, offset) as Array<{ envelope_json: string }>;
      return rows.map((row) => this.deserialize(row.envelope_json));
    });
  }

  async count(): Promise<number> {
    return this.withConnection((db) => {
      const row = db.prepare('SELECT COUNT(*) AS c FROM emails').get() as { c?: number } | undefined;
      return typeof row?.c === 'number' ? row.c : 0;
    });
  }

  async getById(id: string): Promise<EmailEnvelope | null> {
    this.assertId(id);
    return this.withConnection((db) => {
      const row = db.prepare('SELECT envelope_json FROM emails WHERE id = ?').get(id) as { envelope_json: string } | undefined;
      return row ? this.deserialize(row.envelope_json) : null;
    });
  }

  async upsertMany(envelopes: readonly EmailEnvelope[]): Promise<void> {
    if (!Array.isArray(envelopes) || envelopes.length === 0) return;
    await this.transaction((db) => {
      const stmt = db.prepare(
        `INSERT INTO emails (id, date_iso, envelope_json)
         VALUES (@id, @date_iso, @envelope_json)
         ON CONFLICT(id) DO UPDATE SET
           date_iso = excluded.date_iso,
           envelope_json = excluded.envelope_json`
      );
      for (const envelope of envelopes) {
        this.assertEnvelope(envelope);
        stmt.run({
          id: envelope.id,
          date_iso: envelope.date,
          envelope_json: stringify(envelope),
        });
      }
      return undefined;
    });
  }

  async delete(id: string): Promise<boolean> {
    this.assertId(id);
    return this.transaction((db) => {
      const result = db.prepare('DELETE FROM emails WHERE id = ?').run(id);
      return result.changes > 0;
    });
  }

  async clear(): Promise<void> {
    await this.transaction((db) => {
      db.prepare('DELETE FROM emails').run();
      return undefined;
    });
  }

  private deserialize(json: string): EmailEnvelope {
    const parsed = JSON.parse(json);
    this.assertEnvelope(parsed);
    return parsed;
  }

  private assertId(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('EmailsRepository: id is required');
    }
  }

  private assertEnvelope(envelope: any): asserts envelope is EmailEnvelope {
    if (!envelope || typeof envelope !== 'object') {
      throw new Error('EmailsRepository: envelope payload required');
    }
    this.assertId(envelope.id);
    if (typeof envelope.date !== 'string' || !envelope.date.trim()) {
      throw new Error(`EmailsRepository: date required for '${envelope.id}'`);
    }
  }
}
