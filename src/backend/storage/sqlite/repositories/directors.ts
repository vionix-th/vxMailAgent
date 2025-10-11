import type { Director } from '../../../../shared/types';
import type { StorageHandle } from '../types';
import { SqliteRepository, stringify } from './base';
import { validateDirectorToolConfig } from '../../../services/tool-config-service';

export class DirectorsRepository extends SqliteRepository {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async list(): Promise<readonly Director[]> {
    return this.withConnection((db) => {
      const rows = db.prepare(
        'SELECT id, name, prompt_id, api_config_id, enabled_tool_calls_json, agent_ids_json FROM directors ORDER BY name'
      ).all();
      return rows.map((row: any) => this.mapRow(row));
    });
  }

  async getById(id: string): Promise<Director | null> {
    this.assertId(id);
    return this.withConnection((db) => {
      const row = db
        .prepare(
          'SELECT id, name, prompt_id, api_config_id, enabled_tool_calls_json, agent_ids_json FROM directors WHERE id = ?'
        )
        .get(id);
      return row ? this.mapRow(row) : null;
    });
  }

  async insert(director: Director): Promise<void> {
    this.assertDirector(director);
    await this.transaction((db) => {
      const exists = db.prepare('SELECT 1 FROM directors WHERE id = ?').get(director.id);
      if (exists) {
        throw new Error(`DirectorsRepository: director '${director.id}' already exists`);
      }
      db.prepare(
        'INSERT INTO directors (id, name, prompt_id, api_config_id, enabled_tool_calls_json, agent_ids_json) VALUES (@id, @name, @prompt_id, @api_config_id, @enabled_tool_calls_json, @agent_ids_json)'
      ).run({
        id: director.id,
        name: director.name,
        prompt_id: director.promptId,
        api_config_id: director.apiConfigId,
        enabled_tool_calls_json: stringify(director.enabledOptionalTools),
        agent_ids_json: stringify(director.agentIds),
      });
    });
  }

  async update(director: Director): Promise<void> {
    this.assertDirector(director);
    await this.transaction((db) => {
      const result = db
        .prepare(
          'UPDATE directors SET name = @name, prompt_id = @prompt_id, api_config_id = @api_config_id, enabled_tool_calls_json = @enabled_tool_calls_json, agent_ids_json = @agent_ids_json WHERE id = @id'
        )
        .run({
          id: director.id,
          name: director.name,
          prompt_id: director.promptId,
          api_config_id: director.apiConfigId,
          enabled_tool_calls_json: stringify(director.enabledOptionalTools),
          agent_ids_json: stringify(director.agentIds),
        });
      if (result.changes === 0) {
        throw new Error(`DirectorsRepository: director '${director.id}' not found`);
      }
    });
  }

  async delete(id: string): Promise<boolean> {
    this.assertId(id);
    return this.transaction((db) => {
      const result = db.prepare('DELETE FROM directors WHERE id = ?').run(id);
      return result.changes > 0;
    });
  }

  async getAll(): Promise<Director[]> {
    const rows = await this.list();
    return [...rows];
  }

  private mapRow(row: any): Director {
    const enabled = JSON.parse(row.enabled_tool_calls_json);
    const agentIds = JSON.parse(row.agent_ids_json);
    if (!Array.isArray(enabled)) {
      throw new Error(`DirectorsRepository: enabledOptionalTools invalid for director '${row.id}'`);
    }
    if (!Array.isArray(agentIds)) {
      throw new Error(`DirectorsRepository: agentIds invalid for director '${row.id}'`);
    }
    return {
      id: row.id,
      name: row.name,
      promptId: row.prompt_id,
      apiConfigId: row.api_config_id,
      enabledOptionalTools: enabled,
      agentIds,
    } as Director;
  }

  private assertId(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('DirectorsRepository: id is required');
    }
  }

  private assertDirector(director: Director): void {
    if (!director || typeof director !== 'object') {
      throw new Error('DirectorsRepository: director payload required');
    }
    this.assertId(director.id);
    if (typeof director.name !== 'string' || !director.name.trim()) {
      throw new Error(`DirectorsRepository: name required for '${director.id}'`);
    }
    if (typeof director.promptId !== 'string' || !director.promptId.trim()) {
      throw new Error(`DirectorsRepository: promptId required for '${director.id}'`);
    }
    if (typeof director.apiConfigId !== 'string' || !director.apiConfigId.trim()) {
      throw new Error(`DirectorsRepository: apiConfigId required for '${director.id}'`);
    }
    if (!Array.isArray(director.agentIds)) {
      throw new Error(`DirectorsRepository: agentIds must be an array for '${director.id}'`);
    }
    if (!Array.isArray(director.enabledOptionalTools)) {
      throw new Error(`DirectorsRepository: enabledOptionalTools must be an array for '${director.id}'`);
    }
    validateDirectorToolConfig(director);
  }
}
