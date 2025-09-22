import type { EmailEnvelope } from '../../../../shared/types';
import type { StorageHandle } from '../types';
import { SqliteRepository, stringify } from './base';

export class EmailsRepository extends SqliteRepository {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async getAll(): Promise<EmailEnvelope[]> {
    return this.withConnection((db) => {
      const rows = db.prepare('SELECT envelope_json FROM emails ORDER BY date_iso').all();
      return rows.map((row: any) => JSON.parse(row.envelope_json) as EmailEnvelope);
    });
  }

  async setAll(emails: EmailEnvelope[]): Promise<void> {
    await this.transaction((db) => {
      db.prepare('DELETE FROM emails').run();
      const insert = db.prepare('INSERT INTO emails (id, date_iso, envelope_json) VALUES (@id, @date_iso, @envelope_json)');
      for (const email of emails) {
        insert.run({
          id: email.id,
          date_iso: email.date,
          envelope_json: stringify(email),
        });
      }
      return undefined;
    });
  }
}
