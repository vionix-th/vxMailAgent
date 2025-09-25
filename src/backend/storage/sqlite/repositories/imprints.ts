import type { Imprint } from '../../../../shared/types';
import type { StorageHandle } from '../types';
import { SqliteRepository } from './base';

export class ImprintsRepository extends SqliteRepository {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async list(): Promise<readonly Imprint[]> {
    return this.withConnection((db) => {
      const rows = db.prepare('SELECT id, name, content, agent_id FROM imprints ORDER BY name').all();
      return rows.map((row: any) => this.mapRow(row));
    });
  }

  async getById(id: string): Promise<Imprint | null> {
    this.assertId(id);
    return this.withConnection((db) => {
      const row = db.prepare('SELECT id, name, content, agent_id FROM imprints WHERE id = ?').get(id);
      return row ? this.mapRow(row) : null;
    });
  }

  async insert(imprint: Imprint): Promise<void> {
    this.assertImprint(imprint);
    await this.transaction((db) => {
      const exists = db.prepare('SELECT 1 FROM imprints WHERE id = ?').get(imprint.id);
      if (exists) {
        throw new Error(`ImprintsRepository: imprint '${imprint.id}' already exists`);
      }
      db.prepare('INSERT INTO imprints (id, name, content, agent_id) VALUES (@id, @name, @content, @agent_id)').run({
        id: imprint.id,
        name: imprint.name,
        content: imprint.content,
        agent_id: imprint.agentId,
      });
      return undefined;
    });
  }

  async update(imprint: Imprint): Promise<void> {
    this.assertImprint(imprint);
    await this.transaction((db) => {
      const result = db
        .prepare('UPDATE imprints SET name = @name, content = @content, agent_id = @agent_id WHERE id = @id')
        .run({
          id: imprint.id,
          name: imprint.name,
          content: imprint.content,
          agent_id: imprint.agentId,
        });
      if (result.changes === 0) {
        throw new Error(`ImprintsRepository: imprint '${imprint.id}' not found`);
      }
      return undefined;
    });
  }

  async delete(id: string): Promise<boolean> {
    this.assertId(id);
    return this.transaction((db) => {
      const result = db.prepare('DELETE FROM imprints WHERE id = ?').run(id);
      return result.changes > 0;
    });
  }

  private mapRow(row: any): Imprint {
    return {
      id: row.id,
      name: row.name,
      content: row.content,
      agentId: row.agent_id,
    };
  }

  private assertId(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('ImprintsRepository: id is required');
    }
  }

  private assertImprint(imprint: Imprint): void {
    if (!imprint || typeof imprint !== 'object') {
      throw new Error('ImprintsRepository: imprint payload required');
    }
    this.assertId(imprint.id);
    if (typeof imprint.name !== 'string' || !imprint.name.trim()) {
      throw new Error(`ImprintsRepository: name required for '${imprint.id}'`);
    }
    if (typeof imprint.content !== 'string' || !imprint.content.trim()) {
      throw new Error(`ImprintsRepository: content required for '${imprint.id}'`);
    }
    if (typeof imprint.agentId !== 'string' || !imprint.agentId.trim()) {
      throw new Error(`ImprintsRepository: agentId required for '${imprint.id}'`);
    }
  }
}
