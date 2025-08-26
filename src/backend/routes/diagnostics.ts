import express from 'express';
import { DATA_DIR } from '../utils/paths';
import { VX_MAILAGENT_KEY } from '../config';

/** Dependencies for diagnostics routes. */
export interface DiagnosticsRoutesDeps {
  getOrchestrationLog: () => any[];
  getConversations: () => any[];
}

/** Register runtime diagnostics routes. */
export default function registerDiagnosticsRoutes(app: express.Express, deps: DiagnosticsRoutesDeps) {
  app.get('/api/diagnostics/runtime', (_req, res) => {
    const raw = VX_MAILAGENT_KEY || '';
    const isHex64 = /^[0-9a-fA-F]{64}$/.test(raw);
    const encryption = {
      enabled: isHex64,
      mode: isHex64 ? 'enabled' : 'disabled',
      reason: isHex64 ? 'valid 64-hex key' : (raw === '' ? 'empty key: encryption disabled by configuration' : 'missing/invalid key: encryption disabled'),
    } as const;
    res.json({
      timestamp: new Date().toISOString(),
      encryption,
      dataDir: DATA_DIR,
      orchestrationLogCount: deps.getOrchestrationLog().length,
      conversationsCount: deps.getConversations().length,
      versions: { node: process.version },
    });
  });
}
