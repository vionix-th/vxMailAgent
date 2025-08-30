// Main server entry point
import { configureApp } from './config/server-config';
import { registerRoutes } from './config/route-registry';
import { initializeRepositories, createFetcherManager, bootstrapFetchers } from './config/bootstrap';

/** Create and configure the backend Express server. */
export function createServer() {
  // Configure Express application
  const app = configureApp();

  // Initialize system repositories
  initializeRepositories();

  // Create fetcher manager
  const fetcherManager = createFetcherManager();

  // Register all routes
  registerRoutes(app, fetcherManager);

  // Bootstrap fetchers for auto-start users
  bootstrapFetchers(fetcherManager);

  return app;
}
