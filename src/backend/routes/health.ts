import express from 'express';

export default function registerHealthRoutes(app: express.Express) {
  app.get('/api/health', (_req, res) => {
    console.log(`[${new Date().toISOString()}] Health check request received`);
    res.json({ status: 'ok' });
  });
}
