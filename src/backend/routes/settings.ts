import express from 'express';
import * as persistence from '../persistence';
import { SETTINGS_FILE } from '../utils/paths';

export interface SettingsRoutesDeps {
  getSettings: () => any;
}

export default function registerSettingsRoutes(app: express.Express, deps: SettingsRoutesDeps) {
  // GET /api/settings
  app.get('/api/settings', (_req, res) => {
    const settings = deps.getSettings();
    console.log(`[${new Date().toISOString()}] GET /api/settings`);
    res.json({
      virtualRoot: settings.virtualRoot || '',
      apiConfigs: settings.apiConfigs || [],
      signatures: settings.signatures || {},
      fetcherAutoStart: typeof settings.fetcherAutoStart === 'boolean' ? settings.fetcherAutoStart : true,
      sessionTimeoutMinutes: typeof settings.sessionTimeoutMinutes === 'number' ? settings.sessionTimeoutMinutes : 15,
    });
  });

  // PUT /api/settings
  app.put('/api/settings', (req, res) => {
    const settings = deps.getSettings();
    // Accept and persist all advanced fields
    settings.virtualRoot = req.body.virtualRoot || '';
    settings.apiConfigs = Array.isArray(req.body.apiConfigs) ? req.body.apiConfigs : [];
    settings.signatures = req.body.signatures || {};
    if (typeof req.body.fetcherAutoStart === 'boolean') {
      settings.fetcherAutoStart = req.body.fetcherAutoStart;
    }
    if (typeof req.body.sessionTimeoutMinutes === 'number') {
      settings.sessionTimeoutMinutes = req.body.sessionTimeoutMinutes;
    }
    persistence.encryptAndPersist(settings, SETTINGS_FILE);
    console.log(`[${new Date().toISOString()}] PUT /api/settings: updated`);
    res.json({ success: true });
  });
}
