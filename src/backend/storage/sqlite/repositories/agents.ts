import type { Agent } from '../../../../shared/types';
import type { StorageHandle } from '../types';
import { SqliteRepository, stringify } from './base';
import { validateAgentToolConfig } from '../../../services/tool-config-service';

export class AgentsRepository extends SqliteRepository {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async list(): Promise<readonly Agent[]> {
    return this.withConnection((db) => {
      const rows = db.prepare(
        'SELECT id, name, type, prompt_id, api_config_id, enabled_tool_calls_json FROM agents ORDER BY name'
      ).all();
      return rows.map((row: any) => this.mapRow(row));
    });
  }

  async getById(id: string): Promise<Agent | null> {
    this.assertId(id);
    return this.withConnection((db) => {
      const row = db
        .prepare(
          'SELECT id, name, type, prompt_id, api_config_id, enabled_tool_calls_json FROM agents WHERE id = ?'
        )
        .get(id);
      return row ? this.mapRow(row) : null;
    });
  }

  async insert(agent: Agent): Promise<void> {
    this.assertAgent(agent);
    await this.transaction((db) => {
      const exists = db.prepare('SELECT 1 FROM agents WHERE id = ?').get(agent.id);
      if (exists) {
        throw new Error(`AgentsRepository: agent '${agent.id}' already exists`);
      }
      db.prepare(
        'INSERT INTO agents (id, name, type, prompt_id, api_config_id, enabled_tool_calls_json) VALUES (@id, @name, @type, @prompt_id, @api_config_id, @enabled_tool_calls_json)'
      ).run({
        id: agent.id,
        name: agent.name,
        type: agent.type,
        prompt_id: agent.promptId,
        api_config_id: agent.apiConfigId,
        enabled_tool_calls_json: stringify(agent.enabledToolCalls),
      });
    });
  }

  async update(agent: Agent): Promise<void> {
    this.assertAgent(agent);
    await this.transaction((db) => {
      const result = db
        .prepare(
          'UPDATE agents SET name = @name, type = @type, prompt_id = @prompt_id, api_config_id = @api_config_id, enabled_tool_calls_json = @enabled_tool_calls_json WHERE id = @id'
        )
        .run({
          id: agent.id,
          name: agent.name,
          type: agent.type,
          prompt_id: agent.promptId,
          api_config_id: agent.apiConfigId,
          enabled_tool_calls_json: stringify(agent.enabledToolCalls),
        });
      if (result.changes === 0) {
        throw new Error(`AgentsRepository: agent '${agent.id}' not found`);
      }
    });
  }

  async delete(id: string): Promise<boolean> {
    this.assertId(id);
    return this.transaction((db) => {
      const result = db.prepare('DELETE FROM agents WHERE id = ?').run(id);
      return result.changes > 0;
    });
  }

  async getAll(): Promise<Agent[]> {
    const rows = await this.list();
    return [...rows];
  }

  private mapRow(row: any): Agent {
    const enabled = JSON.parse(row.enabled_tool_calls_json);
    if (!Array.isArray(enabled)) {
      throw new Error(`AgentsRepository: enabledToolCalls invalid for agent '${row.id}'`);
    }
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      promptId: row.prompt_id,
      apiConfigId: row.api_config_id,
      enabledToolCalls: enabled,
    } as Agent;
  }

  private assertId(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('AgentsRepository: id is required');
    }
  }

  private assertAgent(agent: Agent): void {
    if (!agent || typeof agent !== 'object') {
      throw new Error('AgentsRepository: agent payload required');
    }
    this.assertId(agent.id);
    if (typeof agent.name !== 'string' || !agent.name.trim()) {
      throw new Error(`AgentsRepository: name required for '${agent.id}'`);
    }
    if (typeof agent.type !== 'string' || !agent.type.trim()) {
      throw new Error(`AgentsRepository: type required for '${agent.id}'`);
    }
    if (typeof agent.promptId !== 'string' || !agent.promptId.trim()) {
      throw new Error(`AgentsRepository: promptId required for '${agent.id}'`);
    }
    if (typeof agent.apiConfigId !== 'string' || !agent.apiConfigId.trim()) {
      throw new Error(`AgentsRepository: apiConfigId required for '${agent.id}'`);
    }
    if (!Array.isArray(agent.enabledToolCalls) || agent.enabledToolCalls.length === 0) {
      throw new Error(`AgentsRepository: enabledToolCalls must be non-empty for '${agent.id}'`);
    }
    validateAgentToolConfig(agent);
  }
}
