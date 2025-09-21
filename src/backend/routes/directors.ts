import express from 'express';
import { Director } from '../../shared/types';
import { LiveRepos } from '../liveRepos';
import { createCrudRoutes } from './helpers';
import { sanitizeEnabled } from '../utils/sanitizeToolCalls';

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
        if (!Array.isArray(enabled)) throw new Error('enabledToolCalls is required and must be an array');
        return { ...director, enabledToolCalls: enabled } as Director;
      },
      mergeUpdate: (current: Director, patch: Partial<Director>): Director => {
        const next: Director = {
          ...current,
          ...(typeof (patch as any).name === 'string' ? { name: (patch as any).name } : {}),
          ...(Array.isArray((patch as any).agentIds) ? { agentIds: (patch as any).agentIds } : {}),
          ...(typeof (patch as any).promptId === 'string' ? { promptId: (patch as any).promptId } : {}),
          ...(typeof (patch as any).apiConfigId === 'string' ? { apiConfigId: (patch as any).apiConfigId } : {}),
          ...(Array.isArray((patch as any).enabledToolCalls) ? { enabledToolCalls: (patch as any).enabledToolCalls as any } : {}),
        } as Director;
        return next;
      },
    }
  );
}
