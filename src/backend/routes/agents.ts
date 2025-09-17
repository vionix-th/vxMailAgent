import express from 'express';
import { Agent } from '../../shared/types';
import { LiveRepos } from '../liveRepos';
import { createCrudRoutes } from './helpers';
import { sanitizeEnabled } from '../utils/sanitizeToolCalls';

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
        return {
          ...agent,
          enabledToolCalls: Array.isArray(enabled) ? enabled : [],
        } as Agent;
      }
    }
  );
}
