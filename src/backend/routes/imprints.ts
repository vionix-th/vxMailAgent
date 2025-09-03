import express from 'express';
import { LiveRepos } from '../liveRepos';
import { createCrudRoutes } from './helpers';

export default function registerImprintsRoutes(app: express.Express, repos: LiveRepos) {
  createCrudRoutes(
    app,
    '/api/imprints',
    {
      getAll: repos.getImprints,
      setAll: repos.setImprints,
    },
    {
      itemName: 'Imprint',
      idField: 'id'
    }
  );
}

