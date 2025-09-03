import express from 'express';
import { DATA_DIR } from '../utils/paths';
import { ReqLike } from '../utils/repo-access';

import { LiveRepos } from '../liveRepos';

/** Register runtime diagnostics routes. */
export default function registerDiagnosticsRoutes(
  app: express.Express, 
  repos: LiveRepos
) {
  app.get('/api/diagnostics/runtime', async (req, res) => {
    const [orch, conv] = await Promise.all([
      repos.getOrchestrationLog(req as any as ReqLike),
      repos.getConversations(req as any as ReqLike),
    ]);
    res.json({
      timestamp: new Date().toISOString(),
      dataDir: DATA_DIR,
      orchestrationLogCount: orch.length,
      conversationsCount: conv.length,
      versions: { node: process.version },
    });
  });
}
