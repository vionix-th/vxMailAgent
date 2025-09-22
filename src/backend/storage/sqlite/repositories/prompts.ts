import type { Prompt, PromptMessage } from '../../../../shared/types';
import type { StorageHandle } from '../types';
import { SqliteRepository, stringify } from './base';

export class PromptsRepository extends SqliteRepository {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async getAll(): Promise<Prompt[]> {
    return this.withConnection((db) => {
      const rows = db.prepare('SELECT id, name, messages_json FROM prompts ORDER BY name').all();
      return rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        messages: JSON.parse(row.messages_json) as PromptMessage[],
      }));
    });
  }

  async setAll(prompts: Prompt[]): Promise<void> {
    await this.transaction((db) => {
      db.prepare('DELETE FROM prompts').run();
      const insert = db.prepare('INSERT INTO prompts (id, name, messages_json) VALUES (@id, @name, @messages_json)');
      for (const prompt of prompts) {
        insert.run({
          id: prompt.id,
          name: prompt.name,
          messages_json: stringify(prompt.messages),
        });
      }
      return undefined;
    });
  }
}
