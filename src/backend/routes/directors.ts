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
        if (!director.apiConfigId) {
          throw new Error('apiConfigId is required for Director');
        }
      },
      afterValidate: (director: Director) => ({
        ...director,
        promptId: (director as any).promptId || '',
        enabledToolCalls: sanitizeEnabled((director as any).enabledToolCalls)
      } as Director),
      transformList: (directors: Director[]) => 
        directors.map(d => ({ ...d, promptId: (d as any).promptId || '' }))
    }
  );
}

