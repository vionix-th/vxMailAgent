import type { Director } from '../../../../shared/types';
import type { StorageHandle } from '../types';
import { SqliteRepository, stringify } from './base';
import { validateDirectorToolConfig } from '../../../services/tool-config-service';

export class DirectorsRepository extends SqliteRepository {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async getAll(): Promise<Director[]> {
    return this.withConnection((db) => {
      const rows = db.prepare(
        'SELECT id, name, prompt_id, api_config_id, enabled_tool_calls_json, agent_ids_json FROM directors ORDER BY name'
      ).all();
      return rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        promptId: row.prompt_id,
        apiConfigId: row.api_config_id,
        enabledToolCalls: JSON.parse(row.enabled_tool_calls_json) as string[],
        agentIds: JSON.parse(row.agent_ids_json) as string[],
      }));
    });
  }

  async setAll(directors: Director[]): Promise<void> {
    for (const director of directors) {
      validateDirectorToolConfig(director);
    }
    await this.transaction((db) => {
      db.prepare('DELETE FROM directors').run();
      const insert = db.prepare(
        'INSERT INTO directors (id, name, prompt_id, api_config_id, enabled_tool_calls_json, agent_ids_json) VALUES (@id, @name, @prompt_id, @api_config_id, @enabled_tool_calls_json, @agent_ids_json)'
      );
      for (const director of directors) {
        insert.run({
          id: director.id,
          name: director.name,
          prompt_id: director.promptId,
          api_config_id: director.apiConfigId,
          enabled_tool_calls_json: stringify(director.enabledToolCalls),
          agent_ids_json: stringify(director.agentIds),
        });
      }
      return undefined;
    });
  }
}
