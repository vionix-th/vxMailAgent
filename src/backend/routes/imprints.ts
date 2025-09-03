import express from 'express';
import { Imprint } from '../../shared/types';
import { ReqLike } from '../utils/repo-access';
import { createCrudRoutes } from './helpers';

export interface ImprintsRoutesDeps {
  getImprints: (req?: ReqLike) => Promise<Imprint[]>;
  setImprints: (req: ReqLike, next: Imprint[]) => Promise<void> | void;
}

export default function registerImprintsRoutes(app: express.Express, deps: ImprintsRoutesDeps) {
  createCrudRoutes(
    app,
    '/api/imprints',
    {
      get: deps.getImprints,
      set: deps.setImprints
    },
    {
      itemName: 'Imprint',
      idField: 'id'
    }
  );
}

