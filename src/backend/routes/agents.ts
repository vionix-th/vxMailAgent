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
        if (!agent.apiConfigId) {
          throw new Error('apiConfigId is required for Agent');
        }
      },
      afterValidate: (agent: Agent) => ({
        ...agent,
        enabledToolCalls: sanitizeEnabled((agent as any).enabledToolCalls)
      })
    }
  );
}
