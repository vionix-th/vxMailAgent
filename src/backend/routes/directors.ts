import express from 'express';
import type { LiveRepos } from '../liveRepos';
import { Director } from '../../shared/types';
import { createCrudRoutes } from './helpers';
import { sanitizeEnabledOptionalTools } from '../utils/sanitizeToolCalls';
import { validateDirectorToolConfig } from '../services/tool-config-service';
import { getDirectorsRepo, requireReq, ReqLike } from '../utils/repo-access';

export default function registerDirectorsRoutes(app: express.Express, _repos: LiveRepos) {
  const repoFns = {
    list: async (req?: ReqLike) => {
      const repo = getDirectorsRepo(requireReq(req));
      return await repo.list();
    },
    getById: async (req: ReqLike, id: string) => {
      const repo = getDirectorsRepo(requireReq(req));
      return await repo.getById(id);
    },
    create: async (req: ReqLike, item: Director) => {
      const repo = getDirectorsRepo(requireReq(req));
      await repo.insert(item);
    },
    update: async (req: ReqLike, item: Director) => {
      const repo = getDirectorsRepo(requireReq(req));
      await repo.update(item);
    },
    delete: async (req: ReqLike, id: string) => {
      const repo = getDirectorsRepo(requireReq(req));
      return await repo.delete(id);
    },
  };

  createCrudRoutes(
    app,
    '/api/directors',
    repoFns,
    {
      itemName: 'Director',
      idField: 'id'
    },
    {
      validate: (director: Director) => {
        const pid = String((director as any).promptId ?? '').trim();
        if (!pid) throw new Error('promptId is required for Director');
        const aid = String((director as any).apiConfigId ?? '').trim();
        if (!aid) throw new Error('apiConfigId is required for Director');
      },
      afterValidate: (director: Director) => {
        const enabled = sanitizeEnabledOptionalTools((director as any).enabledOptionalTools);
        if (enabled === null) throw new Error('enabledOptionalTools must be an array of optional tool names');
        const normalized = { ...director, enabledOptionalTools: enabled } as Director;
        validateDirectorToolConfig(normalized);
        return normalized;
      },
      mergeUpdate: (current: Director, patch: Partial<Director>): Director => {
        const next: Director = {
          ...current,
          ...(typeof (patch as any).name === 'string' ? { name: (patch as any).name } : {}),
          ...(Array.isArray((patch as any).agentIds) ? { agentIds: (patch as any).agentIds } : {}),
          ...(typeof (patch as any).promptId === 'string' ? { promptId: (patch as any).promptId } : {}),
          ...(typeof (patch as any).apiConfigId === 'string' ? { apiConfigId: (patch as any).apiConfigId } : {}),
        } as Director;
        if (Object.prototype.hasOwnProperty.call(patch, 'enabledOptionalTools')) {
          const enabled = sanitizeEnabledOptionalTools((patch as any).enabledOptionalTools);
          if (enabled === null) {
            throw new Error('enabledOptionalTools update must be an array of optional tool names');
          }
          next.enabledOptionalTools = enabled;
        }
        validateDirectorToolConfig(next);
        return next;
      },
    }
  );
}
