import express from 'express';
import { Director } from '../../shared/types';
import { LiveRepos } from '../liveRepos';
import { createCrudRoutes } from './helpers';
import { sanitizeEnabled } from '../utils/sanitizeToolCalls';
import { validateDirectorToolConfig } from '../services/tool-config-service';

export default function registerDirectorsRoutes(app: express.Express, repos: LiveRepos) {
  createCrudRoutes(
    app,
    '/api/directors',
    {
      getAll: repos.getDirectors,
      setAll: repos.setDirectors,
    },
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
        const enabled = sanitizeEnabled((director as any).enabledToolCalls);
        if (enabled === null) throw new Error('enabledToolCalls must be an array of optional tool names');
        if (enabled.length === 0) throw new Error('enabledToolCalls must include at least one optional tool');
        const normalized = { ...director, enabledToolCalls: enabled } as Director;
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
        validateDirectorToolConfig(next);
        return next;
      },
    }
  );
}
