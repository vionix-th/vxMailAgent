import express from 'express';
import { requireUserContext } from '../middleware/user-context';
import { errorHandler } from '../services/error-handler';
import { securityAudit } from '../services/security-audit';
import logger from '../services/logger';
import { requireReq, repoGetAll, requireUid, ReqLike } from '../utils/repo-access';
import { updateSettingsPartial } from '../services/settings';

export interface SettingsRoutesDeps {}

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
  app.get('/api/settings', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const ureq = requireReq(req as any as ReqLike);
    const uid = requireUid(ureq);
    
    securityAudit.logDataAccess(uid, {
      resource: 'settings',
      operation: 'get',
      success: true
    }, req);
    
    const all = await repoGetAll<any>(ureq, 'settings');
    const settings = (Array.isArray(all) && all[0]) ? all[0] : defaultSettings();
    logger.info('GET /api/settings', { uid });
    const apiConfigsPublic = Array.isArray(settings.apiConfigs)
      ? settings.apiConfigs.map((c: any) => ({ id: c.id, name: c.name, model: c.model, ...(typeof c.maxCompletionTokens === 'number' ? { maxCompletionTokens: c.maxCompletionTokens } : {}) }))
      : [];
    res.json({
      virtualRoot: settings.virtualRoot ?? '',
      apiConfigs: apiConfigsPublic,
      signatures: settings.signatures && typeof settings.signatures === 'object' ? settings.signatures : {},
      fetcherAutoStart: typeof settings.fetcherAutoStart === 'boolean' ? settings.fetcherAutoStart : true,
      sessionTimeoutMinutes: typeof settings.sessionTimeoutMinutes === 'number' ? settings.sessionTimeoutMinutes : 15,
    });
  }));

  // PUT /api/settings (per-user)
  app.put('/api/settings', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const ureq = requireReq(req as any as ReqLike);
    const uid = requireUid(ureq);

    errorHandler.validateInput(typeof req.body === 'object', 'Request body must be an object');

    const updated = await updateSettingsPartial(ureq, req.body);

    securityAudit.logDataAccess(uid, {
      resource: 'settings',
      operation: 'set',
      success: true
    }, req);
    logger.info('PUT /api/settings updated', { uid });
    res.json({ success: true, settings: updated });
  }));
}
