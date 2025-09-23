import type { Agent } from '../../../../shared/types';
import type { StorageHandle } from '../types';
import { SqliteRepository, stringify } from './base';
import { validateAgentToolConfig } from '../../../services/tool-config-service';

export class AgentsRepository extends SqliteRepository {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async getAll(): Promise<Agent[]> {
    return this.withConnection((db) => {
      const rows = db.prepare(
        'SELECT id, name, type, prompt_id, api_config_id, enabled_tool_calls_json FROM agents ORDER BY name'
      ).all();
      return rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        promptId: row.prompt_id,
        apiConfigId: row.api_config_id,
        enabledToolCalls: JSON.parse(row.enabled_tool_calls_json) as string[],
      }));
    });
  }

  async setAll(agents: Agent[]): Promise<void> {
    for (const agent of agents) {
      validateAgentToolConfig(agent);
    }
    await this.transaction((db) => {
      db.prepare('DELETE FROM agents').run();
      const insert = db.prepare(
        'INSERT INTO agents (id, name, type, prompt_id, api_config_id, enabled_tool_calls_json) VALUES (@id, @name, @type, @prompt_id, @api_config_id, @enabled_tool_calls_json)'
      );
      for (const agent of agents) {
        insert.run({
          id: agent.id,
          name: agent.name,
          type: agent.type,
          prompt_id: agent.promptId,
          api_config_id: agent.apiConfigId,
          enabled_tool_calls_json: stringify(agent.enabledToolCalls),
        });
      }
      return undefined;
    });
  }
}
