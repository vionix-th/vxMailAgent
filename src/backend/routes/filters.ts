import express from 'express';
import type { LiveRepos } from '../liveRepos';
import { Filter } from '../../shared/types';
import { createCrudRoutes } from './helpers';
import { getFiltersRepo, requireReq, ReqLike } from '../utils/repo-access';

export default function registerFiltersRoutes(app: express.Express, _repos: LiveRepos) {
  const allowedFields = ['from', 'to', 'cc', 'bcc', 'subject', 'body', 'date'] as const;

  const repoFns = {
    list: async (req?: ReqLike) => {
      const repo = getFiltersRepo(requireReq(req));
      return await repo.list();
    },
    getById: async (req: ReqLike, id: string) => {
      const repo = getFiltersRepo(requireReq(req));
      return await repo.getById(id);
    },
    create: async (req: ReqLike, item: Filter) => {
      const repo = getFiltersRepo(requireReq(req));
      await repo.insert(item);
    },
    update: async (req: ReqLike, item: Filter) => {
      const repo = getFiltersRepo(requireReq(req));
      await repo.update(item);
    },
    delete: async (req: ReqLike, id: string) => {
      const repo = getFiltersRepo(requireReq(req));
      return await repo.delete(id);
    },
    reorder: async (req: ReqLike, orderedIds: readonly string[]) => {
      const repo = getFiltersRepo(requireReq(req));
      await repo.reorder(orderedIds);
    },
  };

  createCrudRoutes(
    app,
    '/api/filters',
    repoFns,
    {
      itemName: 'Filter',
      idField: 'id',
      enableReorder: true
    },
    {
      validate: (filter: Filter) => {
        if (!allowedFields.includes(filter.field as any)) {
          throw new Error(`Invalid filter field: ${filter.field}. Allowed fields: ${allowedFields.join(', ')}`);
        }
        try {
          new RegExp(filter.regex, 'i');
        } catch (err) {
          throw new Error(`Invalid regex: ${String(err)}`);
        }
      },
      mergeUpdate: (current: Filter, patch: Partial<Filter>): Filter => {
        const next: Filter = {
          ...current,
          ...(typeof (patch as any).field === 'string' ? { field: (patch as any).field } : {}),
          ...(typeof (patch as any).regex === 'string' ? { regex: (patch as any).regex } : {}),
          ...(typeof (patch as any).directorId === 'string' ? { directorId: (patch as any).directorId } : {}),
          ...(typeof (patch as any).duplicateAllowed === 'boolean' ? { duplicateAllowed: (patch as any).duplicateAllowed } : {}),
        } as Filter;
        return next;
      }
    }
  );
}
