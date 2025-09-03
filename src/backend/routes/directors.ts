import express from 'express';
import { Director } from '../../shared/types';
import { sanitizeEnabled } from '../utils/sanitizeToolCalls';
import { ReqLike } from '../utils/repo-access';
import { createCrudRoutes } from './helpers';

export interface DirectorsRoutesDeps {
  getDirectors: (req?: ReqLike) => Promise<Director[]>;
  setDirectors: (req: ReqLike, next: Director[]) => Promise<void> | void;
}

export default function registerDirectorsRoutes(app: express.Express, deps: DirectorsRoutesDeps) {
  createCrudRoutes(
    app,
    '/api/directors',
    {
      get: deps.getDirectors,
      set: deps.setDirectors
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

