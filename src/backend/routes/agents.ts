import express from 'express';
import { Agent } from '../../shared/types';
import { LiveRepos } from '../liveRepos';
import { createCrudRoutes } from './helpers';
import { sanitizeEnabled } from '../utils/sanitizeToolCalls';
import { validateAgentToolConfig } from '../services/tool-config-service';

export default function registerAgentsRoutes(app: express.Express, repos: LiveRepos) {
  createCrudRoutes(
    app,
    '/api/agents',
    {
      getAll: repos.getAgents,
      setAll: repos.setAgents,
    },
    {
      itemName: 'Agent',
      idField: 'id'
    },
    {
      validate: (agent: Agent) => {
        const pid = String((agent as any).promptId ?? '').trim();
        if (!pid) throw new Error('promptId is required for Agent');
        const aid = String((agent as any).apiConfigId ?? '').trim();
        if (!aid) throw new Error('apiConfigId is required for Agent');
      },
      afterValidate: (agent: Agent) => {
        const enabled = sanitizeEnabled((agent as any).enabledToolCalls);
        if (enabled === null) {
          throw new Error('enabledToolCalls must be an array of optional tool names');
        }
        if (enabled.length === 0) {
          throw new Error('enabledToolCalls must include at least one optional tool');
        }
        const normalized = {
          ...agent,
          enabledToolCalls: enabled,
        } as Agent;
        validateAgentToolConfig(normalized);
        return normalized;
      },
      mergeUpdate: (current: Agent, patch: Partial<Agent>): Agent => {
        const next: Agent = {
          ...current,
          ...(typeof (patch as any).name === 'string' ? { name: (patch as any).name } : {}),
          ...(typeof (patch as any).promptId === 'string' ? { promptId: (patch as any).promptId } : {}),
          ...(typeof (patch as any).apiConfigId === 'string' ? { apiConfigId: (patch as any).apiConfigId } : {}),
        } as Agent;
        if (Object.prototype.hasOwnProperty.call(patch, 'enabledToolCalls')) {
          const enabled = sanitizeEnabled((patch as any).enabledToolCalls);
          if (enabled === null) {
            throw new Error('enabledToolCalls update must be an array of optional tool names');
          }
          if (enabled.length === 0) {
            throw new Error('enabledToolCalls update must include at least one optional tool');
          }
          next.enabledToolCalls = enabled;
        }
        validateAgentToolConfig(next);
        return next;
      }
    }
  );
}
