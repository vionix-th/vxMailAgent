import express from 'express';
import { JWT_EXPIRES_IN_SEC, CORS_ORIGIN } from '../config';
import { getGoogleLoginUrl, handleGoogleLoginCallback, getUserFromToken } from '../services/auth';

/** Serialize a cookie string. */
function cookieSerialize(name: string, value: string, opts?: { maxAgeSec?: number; secure?: boolean; httpOnly?: boolean; sameSite?: 'Lax' | 'Strict' | 'None'; path?: string; domain?: string }) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  const path = opts?.path ?? '/';
  const sameSite = opts?.sameSite ?? 'Lax';
  const httpOnly = opts?.httpOnly ?? true;
  const secure = opts?.secure ?? false;
  const maxAge = opts?.maxAgeSec;
  parts.push(`Path=${path}`);
  if (maxAge && maxAge > 0) parts.push(`Max-Age=${maxAge}`);
  parts.push(`SameSite=${sameSite}`);
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (opts?.domain) parts.push(`Domain=${opts.domain}`);
  return parts.join('; ');
}

/** Register OAuth-based authentication routes. */
export default function registerAuthSessionRoutes(app: express.Express) {
  app.get('/api/auth/google/initiate', (req, res) => {
    void req;
    const url = getGoogleLoginUrl();
    res.json({ url });
  });

  app.get('/api/auth/google/callback', async (req, res) => {
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    if (!code) return res.status(400).json({ error: 'Missing code' });
    try {
      const { token } = await handleGoogleLoginCallback(code, state);
      const secure = (process.env.NODE_ENV || 'development') === 'production';
      res.setHeader('Set-Cookie', cookieSerialize('vx.session', token, { maxAgeSec: JWT_EXPIRES_IN_SEC, httpOnly: true, sameSite: 'Lax', secure, path: '/' }));
      // Redirect to frontend after setting cookie. Use CORS_ORIGIN when it's a concrete origin; otherwise fallback to '/'
      const origin = (CORS_ORIGIN && CORS_ORIGIN !== '*') ? CORS_ORIGIN : '';
      const location = origin || '/';
      res.redirect(location);
    } catch (e: any) {
      res.status(500).json({ error: 'Login failed', detail: e?.message || String(e || '') });
    }
  });

  app.get('/api/auth/whoami', (req, res) => {
    const cookie = String(req.headers['cookie'] || '');
    let token = '';
    const m = cookie.match(/(?:^|; )vx\.session=([^;]+)/);
    if (m) token = decodeURIComponent(m[1]);
    if (!token) {
      const h = req.headers['authorization'];
      if (typeof h === 'string' && /^bearer /i.test(h)) token = h.slice(7);
    }
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const user = getUserFromToken(token);
    if (!user || !user.id) return res.status(401).json({ error: 'Unauthorized' });
    res.json({ user });
  });

  app.post('/api/auth/logout', (req, res) => {
    void req;
    const secure = (process.env.NODE_ENV || 'development') === 'production';
    const parts = ['vx.session=', 'Path=/', 'SameSite=Lax', 'HttpOnly', 'Max-Age=0'];
    if (secure) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
    res.json({ ok: true });
  });
}
