import { Request, Response, NextFunction } from 'express';
import { JWT_SECRET } from '../config';
import { verifyJwt } from '../utils/jwt';

export interface AuthenticatedRequest extends Request {
  auth?: { uid: string; email?: string; name?: string; picture?: string };
}

function parseCookie(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  const parts = header.split(';');
  for (const p of parts) {
    const i = p.indexOf('=');
    if (i > -1) {
      const k = p.slice(0, i).trim();
      const v = decodeURIComponent(p.slice(i + 1).trim());
      if (k) out[k] = v;
    }
  }
  return out;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const path = (req as any).path || req.url || '';
  // Public endpoints: auth session endpoints, health, and legacy OAuth account flows
  if (
    path.startsWith('/api/auth/') ||
    path === '/api/auth/whoami' ||
    path.startsWith('/api/health')
  ) return next();

  const cookies = parseCookie(req.headers['cookie']);
  let token = cookies['vx.session'];
  if (!token) {
    const h = req.headers['authorization'];
    if (typeof h === 'string' && /^bearer /i.test(h)) token = h.slice(7);
  }
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const payload = verifyJwt(token, JWT_SECRET);
  if (!payload || typeof payload.uid !== 'string') return res.status(401).json({ error: 'Unauthorized' });
  req.auth = { uid: payload.uid, email: payload.email, name: payload.name, picture: payload.picture };
  next();
}
