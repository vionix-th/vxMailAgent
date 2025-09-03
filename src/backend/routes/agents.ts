import express from 'express';
import { Agent } from '../../shared/types';
import { sanitizeEnabled } from '../utils/sanitizeToolCalls';
import { ReqLike } from '../utils/repo-access';
import { createCrudRoutes } from './helpers';

export interface AgentsRoutesDeps {
  getAgents: (req?: ReqLike) => Promise<Agent[]>;
  setAgents: (req: ReqLike, next: Agent[]) => Promise<void> | void;
}

export default function registerAgentsRoutes(app: express.Express, deps: AgentsRoutesDeps) {
  createCrudRoutes(
    app,
    '/api/agents',
    {
      get: deps.getAgents,
      set: deps.setAgents
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
