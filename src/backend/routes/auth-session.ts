import express from 'express';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_LOGIN_CLIENT_ID, GOOGLE_LOGIN_CLIENT_SECRET, GOOGLE_LOGIN_REDIRECT_URI, JWT_EXPIRES_IN_SEC, JWT_SECRET } from '../config';
import { buildGoogleLoginAuthUrl } from '../oauth/googleLogin';
import { exchangeGoogleCode } from '../oauth/google';
import { signJwt, verifyJwt } from '../utils/jwt';
import { upsertUser } from '../services/users';
import { User } from '../../shared/types';

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

export default function registerAuthSessionRoutes(app: express.Express) {
  const googleCfg = {
    clientId: GOOGLE_LOGIN_CLIENT_ID || GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_LOGIN_CLIENT_SECRET || GOOGLE_CLIENT_SECRET,
    redirectUri: GOOGLE_LOGIN_REDIRECT_URI || GOOGLE_REDIRECT_URI,
  };

  app.get('/api/auth/google/initiate', (req, res) => {
    void req;
    const state = JSON.stringify({ mode: 'login', provider: 'google' });
    const url = buildGoogleLoginAuthUrl(googleCfg, state);
    res.json({ url });
  });

  app.get('/api/auth/google/callback', async (req, res) => {
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    if (!code) return res.status(400).json({ error: 'Missing code' });
    try {
      // For now, we accept the state without verification; future: CSRF.
      void state;
      const tokens = await exchangeGoogleCode(googleCfg, code);
      // Fetch OIDC userinfo
      const me: any = await new Promise((resolve, reject) => {
        const https = require('https');
        const req2 = https.request({
          method: 'GET',
          hostname: 'www.googleapis.com',
          path: '/oauth2/v2/userinfo',
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        }, (resp: any) => {
          const chunks: Buffer[] = [];
          resp.on('data', (d: any) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
          resp.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            try {
              const json = JSON.parse(text || '{}');
              if (resp.statusCode >= 200 && resp.statusCode < 300) resolve(json);
              else reject(new Error(`HTTP ${resp.statusCode} ${resp.statusMessage}: ${text}`));
            } catch (e) { reject(new Error(`Invalid JSON from Google: ${text}`)); }
          });
        });
        req2.on('error', (err: any) => reject(err));
        req2.end();
      });
      const subOrId: string = me?.id || me?.sub || '';
      const email: string = me?.email || '';
      if (!subOrId || !email) return res.status(500).json({ error: 'Google profile missing id or email' });
      const uid = `google:${subOrId}`;
      const nowIso = new Date().toISOString();
      const user: User = {
        id: uid,
        email,
        name: me?.name || me?.given_name || undefined,
        picture: me?.picture || undefined,
        createdAt: nowIso,
        lastLoginAt: nowIso,
      };
      // Upsert user (preserve createdAt if exists)
      const saved = upsertUser(user);
      const token = signJwt({ uid: saved.id, email: saved.email, name: saved.name, picture: saved.picture }, JWT_SECRET, { expiresInSec: JWT_EXPIRES_IN_SEC });
      const secure = (process.env.NODE_ENV || 'development') === 'production';
      res.setHeader('Set-Cookie', cookieSerialize('vx.session', token, { maxAgeSec: JWT_EXPIRES_IN_SEC, httpOnly: true, sameSite: 'Lax', secure, path: '/' }));
      // Frontend handles navigation; return JSON with the user
      res.json({ user: saved });
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
    const payload = verifyJwt(token, JWT_SECRET);
    if (!payload || typeof payload.uid !== 'string') return res.status(401).json({ error: 'Unauthorized' });
    res.json({ user: { id: payload.uid, email: payload.email, name: payload.name, picture: payload.picture } });
  });

  // Clear session cookie and log out
  app.post('/api/auth/logout', (req, res) => {
    void req;
    const secure = (process.env.NODE_ENV || 'development') === 'production';
    // Explicitly expire the cookie
    const parts = ['vx.session=', 'Path=/', 'SameSite=Lax', 'HttpOnly', 'Max-Age=0'];
    if (secure) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
    res.json({ ok: true });
  });
}
