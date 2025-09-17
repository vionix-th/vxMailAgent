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
        const pid = String((director as any).promptId || '').trim();
        if (!pid) throw new Error('promptId is required for Director');
        const aid = String((director as any).apiConfigId || '').trim();
        if (!aid) throw new Error('apiConfigId is required for Director');
      },
      afterValidate: (director: Director) => ({
        ...director,
        enabledToolCalls: sanitizeEnabled((director as any).enabledToolCalls) ?? [],
      } as Director),
    }
  );
}
