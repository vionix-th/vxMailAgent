import express from 'express';
import { requireUserContext, UserRequest, getUserContext } from '../middleware/user-context';
import { errorHandler } from '../services/error-handler';
import { securityAudit } from '../services/security-audit';

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
  app.get('/api/settings', requireUserContext as any, errorHandler.wrapAsync(async (req: UserRequest, res: express.Response) => {
    const { uid, repos } = getUserContext(req);
    
    securityAudit.logDataAccess(uid, {
      resource: 'settings',
      operation: 'get',
      success: true
    }, req);
    
    const all = repos.settings.getAll();
    const settings = (Array.isArray(all) && all[0]) ? all[0] : defaultSettings();
    console.log(`[${new Date().toISOString()}] GET /api/settings (uid=${uid})`);
    res.json({
      virtualRoot: settings.virtualRoot || '',
      apiConfigs: Array.isArray(settings.apiConfigs) ? settings.apiConfigs : [],
      signatures: settings.signatures && typeof settings.signatures === 'object' ? settings.signatures : {},
      fetcherAutoStart: typeof settings.fetcherAutoStart === 'boolean' ? settings.fetcherAutoStart : true,
      sessionTimeoutMinutes: typeof settings.sessionTimeoutMinutes === 'number' ? settings.sessionTimeoutMinutes : 15,
    });
  }));

  // PUT /api/settings (per-user)
  app.put('/api/settings', requireUserContext as any, errorHandler.wrapAsync(async (req: UserRequest, res: express.Response) => {
    const { repos, uid } = getUserContext(req);
    
    // Input validation
    errorHandler.validateInput(typeof req.body === 'object', 'Request body must be an object');
    
    const next = {
      virtualRoot: req.body?.virtualRoot || '',
      apiConfigs: Array.isArray(req.body?.apiConfigs) ? req.body.apiConfigs : [],
      signatures: req.body?.signatures || {},
      fetcherAutoStart: typeof req.body?.fetcherAutoStart === 'boolean' ? req.body.fetcherAutoStart : true,
      sessionTimeoutMinutes: typeof req.body?.sessionTimeoutMinutes === 'number' ? req.body.sessionTimeoutMinutes : 15,
    } as any;
    
    repos.settings.setAll([next]);
    
    securityAudit.logDataAccess(uid, {
      resource: 'settings',
      operation: 'set',
      success: true
    }, req);
    
    console.log(`[${new Date().toISOString()}] PUT /api/settings (uid=${uid}): updated`);
    res.json({ success: true });
  }));
}
