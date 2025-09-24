import type { Prompt, PromptMessage } from '../../../../shared/types';
import type { StorageHandle } from '../types';
import { SqliteRepository, stringify } from './base';

export class PromptsRepository extends SqliteRepository {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async list(): Promise<readonly Prompt[]> {
    return this.withConnection((db) => {
      const rows = db.prepare('SELECT id, name, messages_json FROM prompts ORDER BY name').all();
      return rows.map((row: any) => this.mapRow(row));
    });
  }

  async getById(id: string): Promise<Prompt | null> {
    this.assertId(id);
    return this.withConnection((db) => {
      const row = db.prepare('SELECT id, name, messages_json FROM prompts WHERE id = ?').get(id);
      return row ? this.mapRow(row) : null;
    });
  }

  async insert(prompt: Prompt): Promise<void> {
    this.assertPrompt(prompt);
    await this.transaction((db) => {
      const exists = db.prepare('SELECT 1 FROM prompts WHERE id = ?').get(prompt.id);
      if (exists) {
        throw new Error(`PromptsRepository: prompt '${prompt.id}' already exists`);
      }
      db.prepare('INSERT INTO prompts (id, name, messages_json) VALUES (@id, @name, @messages_json)').run({
        id: prompt.id,
        name: prompt.name,
        messages_json: stringify(prompt.messages),
      });
    });
  }

  async update(prompt: Prompt): Promise<void> {
    this.assertPrompt(prompt);
    await this.transaction((db) => {
      const result = db
        .prepare('UPDATE prompts SET name = @name, messages_json = @messages_json WHERE id = @id')
        .run({
          id: prompt.id,
          name: prompt.name,
          messages_json: stringify(prompt.messages),
        });
      if (result.changes === 0) {
        throw new Error(`PromptsRepository: prompt '${prompt.id}' not found`);
      }
    });
  }

  async delete(id: string): Promise<boolean> {
    this.assertId(id);
    return this.transaction((db) => {
      const result = db.prepare('DELETE FROM prompts WHERE id = ?').run(id);
      return result.changes > 0;
    });
  }

  async getAll(): Promise<Prompt[]> {
    const rows = await this.list();
    return [...rows];
  }

  private mapRow(row: any): Prompt {
    const messages = JSON.parse(row.messages_json);
    if (!Array.isArray(messages)) {
      throw new Error(`PromptsRepository: messages invalid for prompt '${row.id}'`);
    }
    return {
      id: row.id,
      name: row.name,
      messages: messages as PromptMessage[],
    };
  }

  private assertId(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('PromptsRepository: id is required');
    }
  }

  private assertPrompt(prompt: Prompt): void {
    if (!prompt || typeof prompt !== 'object') {
      throw new Error('PromptsRepository: prompt payload required');
    }
    this.assertId(prompt.id);
    if (typeof prompt.name !== 'string' || !prompt.name.trim()) {
      throw new Error(`PromptsRepository: name required for '${prompt.id}'`);
    }
    if (!Array.isArray(prompt.messages)) {
      throw new Error(`PromptsRepository: messages must be an array for '${prompt.id}'`);
    }
  }
}
