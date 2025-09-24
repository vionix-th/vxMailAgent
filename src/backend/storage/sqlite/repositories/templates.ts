import type { TemplateItem } from '../../../../shared/types';
import type { StorageHandle } from '../types';
import { SqliteRepository, stringify } from './base';

export class TemplatesRepository extends SqliteRepository {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async list(): Promise<readonly TemplateItem[]> {
    return this.withConnection((db) => {
      const rows = db.prepare('SELECT id, name, description, messages_json FROM templates ORDER BY name').all();
      return rows.map((row: any) => this.mapRow(row));
    });
  }

  async getById(id: string): Promise<TemplateItem | null> {
    this.assertId(id);
    return this.withConnection((db) => {
      const row = db
        .prepare('SELECT id, name, description, messages_json FROM templates WHERE id = ?')
        .get(id);
      return row ? this.mapRow(row) : null;
    });
  }

  async insert(template: TemplateItem): Promise<void> {
    this.assertTemplate(template);
    await this.transaction((db) => {
      const exists = db.prepare('SELECT 1 FROM templates WHERE id = ?').get(template.id);
      if (exists) {
        throw new Error(`TemplatesRepository: template '${template.id}' already exists`);
      }
      db.prepare('INSERT INTO templates (id, name, description, messages_json) VALUES (@id, @name, @description, @messages_json)').run({
        id: template.id,
        name: template.name,
        description: template.description ?? null,
        messages_json: stringify(template.messages),
      });
    });
  }

  async update(template: TemplateItem): Promise<void> {
    this.assertTemplate(template);
    await this.transaction((db) => {
      const result = db
        .prepare('UPDATE templates SET name = @name, description = @description, messages_json = @messages_json WHERE id = @id')
        .run({
          id: template.id,
          name: template.name,
          description: template.description ?? null,
          messages_json: stringify(template.messages),
        });
      if (result.changes === 0) {
        throw new Error(`TemplatesRepository: template '${template.id}' not found`);
      }
    });
  }

  async delete(id: string): Promise<boolean> {
    this.assertId(id);
    return this.transaction((db) => {
      const result = db.prepare('DELETE FROM templates WHERE id = ?').run(id);
      return result.changes > 0;
    });
  }

  async getAll(): Promise<TemplateItem[]> {
    const rows = await this.list();
    return [...rows];
  }

  private mapRow(row: any): TemplateItem {
    const messages = JSON.parse(row.messages_json);
    if (!Array.isArray(messages)) {
      throw new Error(`TemplatesRepository: messages invalid for template '${row.id}'`);
    }
    return {
      id: row.id,
      name: row.name,
      description: row.description === null ? undefined : row.description,
      messages,
    } as TemplateItem;
  }

  private assertId(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('TemplatesRepository: id is required');
    }
  }

  private assertTemplate(template: TemplateItem): void {
    if (!template || typeof template !== 'object') {
      throw new Error('TemplatesRepository: template payload required');
    }
    this.assertId(template.id);
    if (typeof template.name !== 'string' || !template.name.trim()) {
      throw new Error(`TemplatesRepository: name required for '${template.id}'`);
    }
    if (!Array.isArray(template.messages)) {
      throw new Error(`TemplatesRepository: messages must be an array for '${template.id}'`);
    }
  }
}
