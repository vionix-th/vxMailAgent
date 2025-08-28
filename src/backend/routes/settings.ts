import express from 'express';
import { requireUserContext, UserRequest, getUserContext } from '../middleware/user-context';

export interface SettingsRoutesDeps {
  // Kept for compatibility; not used after per-user refactor
  getSettings?: () => any;
}

export default function registerSettingsRoutes(app: express.Express, _deps: SettingsRoutesDeps) {
  // Local default settings generator
  function defaultSettings() {
    return {
      virtualRoot: '',
      apiConfigs: [],
      signatures: {},
      fetcherAutoStart: true,
      sessionTimeoutMinutes: 15,
    } as any;
  }

  // GET /api/settings (per-user)
  app.get('/api/settings', requireUserContext as any, (req: UserRequest, res) => {
    const { repos } = getUserContext(req);
    const all = repos.settings.getAll();
    const settings = (Array.isArray(all) && all[0]) ? all[0] : defaultSettings();
    console.log(`[${new Date().toISOString()}] GET /api/settings (uid=${getUserContext(req).uid})`);
    res.json({
      virtualRoot: settings.virtualRoot || '',
      apiConfigs: Array.isArray(settings.apiConfigs) ? settings.apiConfigs : [],
      signatures: settings.signatures && typeof settings.signatures === 'object' ? settings.signatures : {},
      fetcherAutoStart: typeof settings.fetcherAutoStart === 'boolean' ? settings.fetcherAutoStart : true,
      sessionTimeoutMinutes: typeof settings.sessionTimeoutMinutes === 'number' ? settings.sessionTimeoutMinutes : 15,
    });
  });

  // PUT /api/settings (per-user)
  app.put('/api/settings', requireUserContext as any, (req: UserRequest, res) => {
    const { repos, uid } = getUserContext(req);
    const next = {
      virtualRoot: req.body?.virtualRoot || '',
      apiConfigs: Array.isArray(req.body?.apiConfigs) ? req.body.apiConfigs : [],
      signatures: req.body?.signatures || {},
      fetcherAutoStart: typeof req.body?.fetcherAutoStart === 'boolean' ? req.body.fetcherAutoStart : true,
      sessionTimeoutMinutes: typeof req.body?.sessionTimeoutMinutes === 'number' ? req.body.sessionTimeoutMinutes : 15,
    } as any;
    repos.settings.setAll([next]);
    console.log(`[${new Date().toISOString()}] PUT /api/settings (uid=${uid}): updated`);
    res.json({ success: true });
  });
}
