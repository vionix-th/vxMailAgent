import express from 'express';
import { requireUserContext } from '../middleware/user-context';
import { errorHandler } from '../services/error-handler';
import { securityAudit } from '../services/security-audit';
import logger from '../services/logger';
import { requireReq, requireUid, ReqLike } from '../utils/repo-access';
import { loadSettings, updateSettingsPartial, createApiConfig, updateApiConfig, deleteApiConfig } from '../services/settings';
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

  app.post('/api/settings/api-configs', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    errorHandler.validateInput(typeof req.body === 'object' && req.body !== null, 'Request body must be an object');
    const ureq = requireReq(req as any as ReqLike);
    const uid = requireUid(ureq);

    const payload = req.body as any;
    const created = await createApiConfig(ureq, {
      id: typeof payload.id === 'string' ? payload.id : undefined,
      name: payload.name,
      model: payload.model,
      apiKey: payload.apiKey,
      provider: typeof payload.provider === 'string' ? payload.provider : undefined,
      maxCompletionTokens: typeof payload.maxCompletionTokens === 'number' ? payload.maxCompletionTokens : undefined,
    });

    securityAudit.logDataAccess(uid, {
      resource: 'settings.apiConfigs',
      operation: 'set',
      success: true,
    }, req);
    logger.info('POST /api/settings/api-configs created', { uid, apiConfigId: created.id });
    res.status(201).json({ success: true, apiConfig: serializeApiConfig(created) });
  }));

  app.put('/api/settings/api-configs/:id', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    errorHandler.validateInput(typeof req.body === 'object' && req.body !== null, 'Request body must be an object');
    const ureq = requireReq(req as any as ReqLike);
    const uid = requireUid(ureq);
    const id = String(req.params.id);

    const payload = req.body as any;
    const updated = await updateApiConfig(ureq, id, {
      ...(Object.prototype.hasOwnProperty.call(payload, 'name') ? { name: payload.name } : {}),
      ...(Object.prototype.hasOwnProperty.call(payload, 'model') ? { model: payload.model } : {}),
      ...(Object.prototype.hasOwnProperty.call(payload, 'apiKey') ? { apiKey: payload.apiKey } : {}),
      ...(Object.prototype.hasOwnProperty.call(payload, 'provider') ? { provider: payload.provider } : {}),
      ...(Object.prototype.hasOwnProperty.call(payload, 'maxCompletionTokens') ? { maxCompletionTokens: payload.maxCompletionTokens } : {}),
    });

    securityAudit.logDataAccess(uid, {
      resource: 'settings.apiConfigs',
      operation: 'set',
      success: true,
    }, req);
    logger.info('PUT /api/settings/api-configs/:id updated', { uid, apiConfigId: id });
    res.json({ success: true, apiConfig: serializeApiConfig(updated) });
  }));

  app.delete('/api/settings/api-configs/:id', requireUserContext as any, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const ureq = requireReq(req as any as ReqLike);
    const uid = requireUid(ureq);
    const id = String(req.params.id);

    await deleteApiConfig(ureq, id);

    securityAudit.logDataAccess(uid, {
      resource: 'settings.apiConfigs',
      operation: 'delete',
      success: true,
    }, req);
    logger.info('DELETE /api/settings/api-configs/:id removed', { uid, apiConfigId: id });
    res.json({ success: true });
  }));
}
