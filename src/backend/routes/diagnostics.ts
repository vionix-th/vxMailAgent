import express from 'express';
import { DATA_DIR } from '../utils/paths';
import { ReqLike } from '../utils/repo-access';

/** Dependencies for diagnostics routes. */
export interface DiagnosticsRoutesDeps {
  getOrchestrationLog: (req?: ReqLike) => Promise<any[]>;
  getConversations: (req?: ReqLike) => Promise<any[]>;
}

/** Register runtime diagnostics routes. */
export default function registerDiagnosticsRoutes(app: express.Express, deps: DiagnosticsRoutesDeps) {
  app.get('/api/diagnostics/runtime', async (req, res) => {
    const [orch, conv] = await Promise.all([
      deps.getOrchestrationLog(req as any as ReqLike),
      deps.getConversations(req as any as ReqLike),
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
