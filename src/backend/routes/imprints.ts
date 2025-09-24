import express from 'express';
import { LiveRepos } from '../liveRepos';
import { createCrudRoutes } from './helpers';
import type { ReqLike } from '../utils/repo-access';
import type { Imprint } from '../../shared/types';

export default function registerImprintsRoutes(app: express.Express, repos: LiveRepos) {
  const repoFns = {
    list: repos.getImprints,
    getById: async (req: ReqLike, id: string) => {
      const current = await repos.getImprints(req);
      return current.find((item) => item.id === id) ?? null;
    },
    create: async (req: ReqLike, item: Imprint) => {
      const current = await repos.getImprints(req);
      await repos.setImprints(req, [...current, item]);
    },
    update: async (req: ReqLike, item: Imprint) => {
      const current = await repos.getImprints(req);
      const idx = current.findIndex((entry) => entry.id === item.id);
      if (idx === -1) {
        throw new Error('Imprint not found');
      }
      const next = current.slice();
      next[idx] = item;
      await repos.setImprints(req, next);
    },
    delete: async (req: ReqLike, id: string) => {
      const current = await repos.getImprints(req);
      const next = current.filter((entry) => entry.id !== id);
      if (next.length === current.length) {
        return false;
      }
      await repos.setImprints(req, next);
      return true;
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
