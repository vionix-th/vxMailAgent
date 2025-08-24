// OAuth logic for Gmail/Outlook
import express from 'express';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, OUTLOOK_REDIRECT_URI } from './config';

const router = express.Router();

// Gmail OAuth2 endpoints (standardized via shared provider)
import { buildGoogleAuthUrl, exchangeGoogleCode } from './oauth/google';
import { computeExpiryISO } from './oauth/common';

const GOOGLE_ENV = {
  CLIENT_ID: GOOGLE_CLIENT_ID!,
  CLIENT_SECRET: GOOGLE_CLIENT_SECRET!,
  REDIRECT_URI: GOOGLE_REDIRECT_URI!,
};

router.get('/oauth2/google/initiate', (req: express.Request, res: express.Response) => {
  const state = (req.query.state as string) || '';
  const url = buildGoogleAuthUrl({ clientId: GOOGLE_ENV.CLIENT_ID, clientSecret: GOOGLE_ENV.CLIENT_SECRET, redirectUri: GOOGLE_ENV.REDIRECT_URI }, state);
  res.json({ url });
});

router.get('/oauth2/google/callback', async (req: express.Request, res: express.Response) => {
  const code = req.query.code as string;
  if (!code) return res.status(400).json({ error: 'Missing code' });
  try {
    const tokens = await exchangeGoogleCode({ clientId: GOOGLE_ENV.CLIENT_ID, clientSecret: GOOGLE_ENV.CLIENT_SECRET, redirectUri: GOOGLE_ENV.REDIRECT_URI }, code);
    // Fetch user info to get email
    const me = await new Promise<any>((resolve, reject) => {
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
    const email = me?.email || '';
    if (!email) return res.status(500).json({ error: 'Google profile missing email address' });
    const account = {
      id: email,
      provider: 'gmail',
      email,
      signature: '',
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken || '',
        expiry: tokens.expiryISO,
      },
    };
    res.json({ account });
  } catch (e) {
    let message = 'OAuth2 callback failed';
    let detail: string | undefined = undefined;
    if (e && typeof e === 'object') {
      if ('message' in e) message = (e as any).message;
      if ('stack' in e) detail = (e as any).stack;
    }
    res.status(500).json({ error: message, detail });
  }
});

// Outlook OAuth2 endpoints
import { getOutlookAuthUrl, getOutlookTokens } from './oauth-outlook';

const OUTLOOK_ENV = {
  CLIENT_ID: OUTLOOK_CLIENT_ID!,
  CLIENT_SECRET: OUTLOOK_CLIENT_SECRET!,
  REDIRECT_URI: OUTLOOK_REDIRECT_URI!,
};

router.get('/oauth2/outlook/initiate', async (req: express.Request, res: express.Response) => {
  const state = (req.query.state as string) || '';
  try {
    const url = await getOutlookAuthUrl(OUTLOOK_ENV.CLIENT_ID, OUTLOOK_ENV.CLIENT_SECRET, OUTLOOK_ENV.REDIRECT_URI, state);
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate Outlook OAuth2 URL' });
  }
});

router.get('/oauth2/outlook/callback', async (req: express.Request, res: express.Response) => {
  const code = req.query.code as string;
  if (!code) return res.status(400).json({ error: 'Missing code' });
  try {
    const tokenResponse = await getOutlookTokens(OUTLOOK_ENV.CLIENT_ID, OUTLOOK_ENV.CLIENT_SECRET, OUTLOOK_ENV.REDIRECT_URI, code);
    // Try to extract email from id_token if present
    let email = '';
    if (tokenResponse?.id_token) {
      try {
        const parts = String(tokenResponse.id_token).split('.');
        if (parts.length >= 2) {
          const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
          email = payload.preferred_username || payload.email || '';
        }
      } catch {}
    }
    if (!email) {
      const accessToken = tokenResponse?.access_token || '';
      if (!accessToken) return res.status(500).json({ error: 'Outlook profile missing email address' });
      const me = await new Promise<any>((resolve, reject) => {
        const https = require('https');
        const req2 = https.request({
          method: 'GET',
          hostname: 'graph.microsoft.com',
          path: '/v1.0/me',
          headers: { Authorization: `Bearer ${accessToken}` },
        }, (resp: any) => {
          const chunks: Buffer[] = [];
          resp.on('data', (d: any) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
          resp.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            try {
              const json = JSON.parse(text || '{}');
              if (resp.statusCode >= 200 && resp.statusCode < 300) resolve(json);
              else reject(new Error(`HTTP ${resp.statusCode} ${resp.statusMessage}: ${text}`));
            } catch (e) { reject(new Error(`Invalid JSON from Graph: ${text}`)); }
          });
        });
        req2.on('error', (err: any) => reject(err));
        req2.end();
      });
      email = (me && (me.mail || (Array.isArray(me.otherMails) && me.otherMails[0]) || me.userPrincipalName)) || '';
    }
    if (!email) return res.status(500).json({ error: 'Outlook profile missing email address' });
    const expiryIso = computeExpiryISO(typeof tokenResponse?.expires_in === 'number' ? tokenResponse.expires_in : undefined);
    const account = {
      id: email,
      provider: 'outlook',
      email,
      signature: '',
      tokens: {
        accessToken: tokenResponse?.access_token || '',
        refreshToken: tokenResponse?.refresh_token || '',
        expiry: expiryIso,
      },
    };
    res.json({ account });
  } catch (e) {
    res.status(500).json({ error: 'Outlook OAuth2 callback failed' });
  }
});

export default router;
