import type { Imprint } from '../../../../shared/types';
import type { StorageHandle } from '../types';
import { SqliteRepository } from './base';

export class ImprintsRepository extends SqliteRepository {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async getAll(): Promise<Imprint[]> {
    return this.withConnection((db) => {
      const rows = db.prepare('SELECT id, name, content, agent_id FROM imprints ORDER BY name').all();
      return rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        content: row.content,
        agentId: row.agent_id,
      }));
    });
  }

  async setAll(imprints: Imprint[]): Promise<void> {
    await this.transaction((db) => {
      db.prepare('DELETE FROM imprints').run();
      const insert = db.prepare('INSERT INTO imprints (id, name, content, agent_id) VALUES (@id, @name, @content, @agent_id)');
      for (const imprint of imprints) {
        insert.run({
          id: imprint.id,
          name: imprint.name,
          content: imprint.content,
          agent_id: imprint.agentId,
        });
      }
      return undefined;
    });
  }
}
