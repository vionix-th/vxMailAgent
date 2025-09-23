import express from 'express';
import { requireUserContext } from '../middleware/user-context';
import { errorHandler } from '../services/error-handler';
import { securityAudit } from '../services/security-audit';
import logger from '../services/logger';
import { requireReq, requireUid, ReqLike } from '../utils/repo-access';
import { loadSettings, updateSettingsPartial } from '../services/settings';
import { serializeApiConfig } from '../services/apiConfigSerializer';

export interface SettingsRoutesDeps {}

export default function registerSettingsRoutes(app: express.Express, _deps: SettingsRoutesDeps) {

  // GET /api/settings (per-user)
  app.get('/api/settings', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const ureq = requireReq(req as any as ReqLike);
    const uid = requireUid(ureq);
    
    securityAudit.logDataAccess(uid, {
      resource: 'settings',
      operation: 'get',
      success: true
    }, req);
    
    const settings = await loadSettings(ureq);
    logger.info('GET /api/settings', { uid });
    const apiConfigsPublic = Array.isArray(settings.apiConfigs)
      ? settings.apiConfigs.map(serializeApiConfig)
      : [];
    res.json({
      virtualRoot: settings.virtualRoot,
      apiConfigs: apiConfigsPublic,
      signatures: settings.signatures,
      fetcherAutoStart: settings.fetcherAutoStart,
      sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
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
