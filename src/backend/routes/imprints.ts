import express from 'express';
import { LiveRepos } from '../liveRepos';
import { createCrudRoutes } from './helpers';
import type { ContextInput } from '../utils/repo-access';
import type { Imprint } from '../../shared/types';

export default function registerImprintsRoutes(app: express.Express, repos: LiveRepos) {
  const repoFns = {
    list: repos.getImprints,
    getById: async (req: ContextInput, id: string) => {
      const current = await repos.getImprints(req);
      return current.find((item) => item.id === id) ?? null;
    },
    create: async (req: ContextInput, item: Imprint) => {
      await repos.insertImprint(req, item);
    },
    update: async (req: ContextInput, item: Imprint) => {
      await repos.updateImprint(req, item);
    },
    delete: async (req: ContextInput, id: string) => {
      return await repos.deleteImprint(req, id);
    },
  };

  createCrudRoutes(
    app,
    '/api/imprints',
    repoFns,
    {
      itemName: 'Imprint',
      idField: 'id'
    },
    {
      mergeUpdate: (current: any, patch: any) => ({
        ...current,
        ...(typeof patch.name === 'string' ? { name: patch.name } : {}),
        ...(typeof patch.content === 'string' ? { content: patch.content } : {}),
      })
    }
  );
}
