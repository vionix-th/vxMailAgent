import express from 'express';
import { DATA_DIR } from '../utils/paths';
import { UserRequest } from '../middleware/user-context';

/** Dependencies for diagnostics routes. */
export interface DiagnosticsRoutesDeps {
  getOrchestrationLog: (req?: UserRequest) => any[];
  getConversations: (req?: UserRequest) => any[];
}

/** Register runtime diagnostics routes. */
export default function registerDiagnosticsRoutes(app: express.Express, deps: DiagnosticsRoutesDeps) {
  app.get('/api/diagnostics/runtime', (req, res) => {
    res.json({
      timestamp: new Date().toISOString(),
      dataDir: DATA_DIR,
      orchestrationLogCount: deps.getOrchestrationLog(req as UserRequest).length,
      conversationsCount: deps.getConversations(req as UserRequest).length,
      versions: { node: process.version },
    });
  });
}
