import express from 'express';
import { signJwt } from '../utils/jwt';
import { JWT_SECRET, JWT_EXPIRES_IN_SEC, isProd, ENABLE_TEST_ROUTES } from '../config';
import { serializeSessionCookie } from '../utils/session';
import { errorHandler, ValidationError } from '../services/error-handler';
import logger from '../services/logger';

export default function registerTestSessionRoute(app: express.Express) {
  if (isProd && !ENABLE_TEST_ROUTES) {
    logger.warn('Test session route not enabled; set ENABLE_TEST_ROUTES=true to expose /api/test/session in production');
    return;
  }

  app.post('/api/test/session', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const rawUid = req.body?.uid;
    const uid = typeof rawUid === 'string' ? rawUid.trim() : '';
    if (!uid) {
      throw new ValidationError('uid is required');
    }
    const payload: Record<string, unknown> = { uid };
    if (typeof req.body?.email === 'string') payload.email = req.body.email;
    if (typeof req.body?.name === 'string') payload.name = req.body.name;
    if (typeof req.body?.picture === 'string') payload.picture = req.body.picture;
    const token = signJwt(payload, JWT_SECRET, { expiresInSec: JWT_EXPIRES_IN_SEC });
    const secure = isProd;
    res.setHeader('Set-Cookie', serializeSessionCookie(token, { maxAgeSec: JWT_EXPIRES_IN_SEC, secure }) as any);
    res.json({ token });
  }));
}
