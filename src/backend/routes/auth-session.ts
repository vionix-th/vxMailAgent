import express from 'express';
import { JWT_EXPIRES_IN_SEC, CORS_ORIGIN, isProd } from '../config';
import { getUserFromToken } from '../services/auth';
import { initiateGoogleLogin, handleGoogleLoginCallback as handleGoogleLoginCallbackV2 } from '../auth/oidc/flows';
import { clearLoginCookie } from '../auth/oidc/issuer';
import { errorHandler, ValidationError, AuthenticationError } from '../services/error-handler';
import { serializeSessionCookie, clearSessionCookie, extractTokenFromHeaders } from '../utils/session';

/** Register OAuth-based authentication routes. */
export default function registerAuthSessionRoutes(app: express.Express) {
  app.get('/api/auth/google/initiate', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    void req;
    const { url, loginCookie } = await initiateGoogleLogin();
    res.setHeader('Set-Cookie', loginCookie);
    res.json({ url });
  }));

  app.get('/api/auth/google/callback', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    if (!code) throw new ValidationError('Missing code');

    const secure = isProd;
    const cookieHeader = typeof req.headers['cookie'] === 'string' ? req.headers['cookie'] : undefined;
    const { token } = await handleGoogleLoginCallbackV2({ code, state, cookieHeader });
    res.setHeader('Set-Cookie', [
      serializeSessionCookie(token, { maxAgeSec: JWT_EXPIRES_IN_SEC, secure }),
      clearLoginCookie(),
    ] as any);
    // Redirect to frontend after setting cookie. Use CORS_ORIGIN when it's a concrete origin; otherwise fallback to '/'
    const origin = (CORS_ORIGIN && CORS_ORIGIN !== '*') ? CORS_ORIGIN : '';
    const location = origin || '/';
    res.redirect(location);
  }));

  app.get('/api/auth/whoami', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const token = extractTokenFromHeaders(req.headers);
    if (!token) throw new AuthenticationError('Unauthorized');
    const user = getUserFromToken(token);
    if (!user || !user.id) throw new AuthenticationError('Unauthorized');
    res.json({ user });
  }));

  app.post('/api/auth/logout', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    void req;
    const secure = isProd;
    res.setHeader('Set-Cookie', clearSessionCookie(secure));
    res.json({ ok: true });
  }));
}
