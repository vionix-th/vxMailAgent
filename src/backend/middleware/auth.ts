import { Request, Response, NextFunction } from 'express';
import { JWT_SECRET } from '../config';
import { verifyJwt } from '../utils/jwt';
import { extractTokenFromHeaders } from '../utils/session';
import logger from '../services/logger';
import { securityAudit } from '../services/security-audit';

export interface AuthenticatedRequest extends Request {
  auth?: { uid: string; email?: string; name?: string; picture?: string };
}

// Cookie and bearer parsing centralized in utils/session.ts

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const path = (req as any).path ?? req.url ?? '';
  // Public endpoints: auth session endpoints and health
  if (
    path.startsWith('/api/auth/') ||
    path === '/api/auth/whoami' ||
    path.startsWith('/api/health')
  ) return next();

  const token = extractTokenFromHeaders(req.headers as Record<string, unknown>);
  const meta = {
    method: req.method,
    path: req.originalUrl ?? path,
    ip: req.ip ?? (req as any)?.connection?.remoteAddress,
    userAgent: typeof req.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
  } as const;
  if (!token) {
    logger.warn('Auth middleware: missing session token', meta);
    securityAudit.logAuthOperation(undefined, { operation: 'access_denied', success: false, reason: 'missing_token' }, req);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let tokenFailureReason: 'invalid' | 'expired' | 'malformed' | null = null;
  const payload = verifyJwt(token, JWT_SECRET, {
    onFailure: ({ reason }) => {
      tokenFailureReason = reason;
    },
  });
  if (!payload || typeof payload.uid !== 'string') {
    const reason = tokenFailureReason ?? 'missing_uid';
    logger.warn('Auth middleware: invalid session token', { ...meta, reason });
    securityAudit.logAuthOperation(undefined, { operation: 'access_denied', success: false, reason: `jwt_${reason}` }, req);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.auth = { uid: payload.uid, email: payload.email, name: payload.name, picture: payload.picture };
  next();
}
