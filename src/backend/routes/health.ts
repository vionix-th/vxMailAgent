import express from 'express';
import logger from '../services/logger';

/** Register a simple health check endpoint. */
export default function registerHealthRoutes(app: express.Express) {
  app.get('/api/health', (_req, res) => {
    logger.info('Health check request received');
    res.json({ status: 'ok' });
  });
}
