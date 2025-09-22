import type { TemplateItem } from '../../../../shared/types';
import type { StorageHandle } from '../types';
import { SqliteRepository, stringify } from './base';

export class TemplatesRepository extends SqliteRepository {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async getAll(): Promise<TemplateItem[]> {
    return this.withConnection((db) => {
      const rows = db.prepare('SELECT id, name, description, messages_json FROM templates ORDER BY name').all();
      return rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        description: row.description === null ? undefined : row.description,
        messages: JSON.parse(row.messages_json),
      }));
    });
  }

  async setAll(templates: TemplateItem[]): Promise<void> {
    await this.transaction((db) => {
      db.prepare('DELETE FROM templates').run();
      const insert = db.prepare('INSERT INTO templates (id, name, description, messages_json) VALUES (@id, @name, @description, @messages_json)');
      for (const template of templates) {
        insert.run({
          id: template.id,
          name: template.name,
          description: template.description ?? null,
          messages_json: stringify(template.messages),
        });
      }
      return undefined;
    });
  }
}
