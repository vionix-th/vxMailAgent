import express from 'express';
import { Filter } from '../../shared/types';
import { ReqLike } from '../utils/repo-access';
import { createCrudRoutes } from './helpers';

export interface FiltersRoutesDeps {
  getFilters: (req?: ReqLike) => Promise<Filter[]>;
  setFilters: (req: ReqLike, next: Filter[]) => Promise<void> | void;
}

const allowedFields = ['from', 'to', 'cc', 'bcc', 'subject', 'body', 'date'] as const;

export default function registerFiltersRoutes(app: express.Express, deps: FiltersRoutesDeps) {
  createCrudRoutes(
    app,
    '/api/filters',
    {
      get: deps.getFilters,
      set: deps.setFilters
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

