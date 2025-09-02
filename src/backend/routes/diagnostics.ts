import express from 'express';
import { DATA_DIR } from '../utils/paths';
import { ReqLike } from '../utils/repo-access';

/** Dependencies for diagnostics routes. */
export interface DiagnosticsRoutesDeps {
  getOrchestrationLog: (req?: ReqLike) => any[];
  getConversations: (req?: ReqLike) => any[];
}

/** Register runtime diagnostics routes. */
export default function registerDiagnosticsRoutes(app: express.Express, deps: DiagnosticsRoutesDeps) {
  app.get('/api/diagnostics/runtime', (req, res) => {
    res.json({
      timestamp: new Date().toISOString(),
      dataDir: DATA_DIR,
      orchestrationLogCount: deps.getOrchestrationLog(req as any as ReqLike).length,
      conversationsCount: deps.getConversations(req as any as ReqLike).length,
      versions: { node: process.version },
    });
  });
}
