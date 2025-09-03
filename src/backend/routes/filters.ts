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
          // eslint-disable-next-line no-new
          new RegExp(filter.regex, 'i');
        } catch (err) {
          throw new Error(`Invalid regex: ${String(err)}`);
        }
      }
    }
  );
}

