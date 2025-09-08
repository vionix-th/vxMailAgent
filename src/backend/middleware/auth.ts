import { Request, Response, NextFunction } from 'express';
import { JWT_SECRET } from '../config';
import { verifyJwt } from '../utils/jwt';
import { extractTokenFromHeaders } from '../utils/session';

export interface AuthenticatedRequest extends Request {
  auth?: { uid: string; email?: string; name?: string; picture?: string };
}

// Cookie and bearer parsing centralized in utils/session.ts

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const path = (req as any).path || req.url || '';
  // Public endpoints: auth session endpoints and health
  if (
    path.startsWith('/api/auth/') ||
    path === '/api/auth/whoami' ||
    path.startsWith('/api/health')
  ) return next();

  const token = extractTokenFromHeaders(req.headers as Record<string, unknown>);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const payload = verifyJwt(token, JWT_SECRET);
  if (!payload || typeof payload.uid !== 'string') return res.status(401).json({ error: 'Unauthorized' });
  req.auth = { uid: payload.uid, email: payload.email, name: payload.name, picture: payload.picture };
  next();
}
