import express from 'express';
import { Filter } from '../../shared/types';
import { LiveRepos } from '../liveRepos';
import { createCrudRoutes } from './helpers';

export default function registerFiltersRoutes(app: express.Express, repos: LiveRepos) {
  const allowedFields = ['from', 'to', 'cc', 'bcc', 'subject', 'body', 'date'] as const;

  createCrudRoutes(
    app,
    '/api/filters',
    {
      getAll: repos.getFilters,
      setAll: repos.setFilters,
    },
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
