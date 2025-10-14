import express from 'express';
import type { LiveRepos } from '../liveRepos';
import { Agent } from '../../shared/types';
import { createCrudRoutes } from './helpers';
import { sanitizeEnabledOptionalTools } from '../utils/sanitizeToolCalls';
import { validateAgentToolConfig } from '../services/tool-config-service';
import { getAgentsRepo, requireContext, ContextInput } from '../utils/repo-access';

export default function registerAgentsRoutes(app: express.Express, _repos: LiveRepos) {
  const repoFns = {
    list: async (req?: ContextInput) => {
      const repo = getAgentsRepo(requireContext(req));
      return await repo.list();
    },
    getById: async (req: ContextInput, id: string) => {
      const repo = getAgentsRepo(requireContext(req));
      return await repo.getById(id);
    },
    create: async (req: ContextInput, item: Agent) => {
      const repo = getAgentsRepo(requireContext(req));
      await repo.insert(item);
    },
    update: async (req: ContextInput, item: Agent) => {
      const repo = getAgentsRepo(requireContext(req));
      await repo.update(item);
    },
    delete: async (req: ContextInput, id: string) => {
      const repo = getAgentsRepo(requireContext(req));
      return await repo.delete(id);
    },
  };

  createCrudRoutes(
    app,
    '/api/agents',
    repoFns,
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
        const enabled = sanitizeEnabledOptionalTools((agent as any).enabledOptionalTools);
        if (enabled === null) {
          throw new Error('enabledOptionalTools must be an array of optional tool names');
        }
        const normalized = {
          ...agent,
          enabledOptionalTools: enabled,
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
        if (Object.prototype.hasOwnProperty.call(patch, 'enabledOptionalTools')) {
          const enabled = sanitizeEnabledOptionalTools((patch as any).enabledOptionalTools);
          if (enabled === null) {
            throw new Error('enabledOptionalTools update must be an array of optional tool names');
          }
          next.enabledOptionalTools = enabled;
        }
        validateAgentToolConfig(next);
        return next;
      }
    }
  );
}
