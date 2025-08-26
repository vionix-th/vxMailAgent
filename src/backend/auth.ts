// OAuth logic for Gmail/Outlook
import express from 'express';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, OUTLOOK_REDIRECT_URI, JWT_SECRET } from './config';

const router = express.Router();

// Gmail OAuth2 endpoints (standardized via shared provider)
import { buildGoogleAuthUrl, exchangeGoogleCode, getGoogleUserInfo } from './oauth/google';
import { signJwt, verifyJwt } from './utils/jwt';
import { computeExpiryISO } from './oauth/common';

const GOOGLE_ENV = {
  CLIENT_ID: GOOGLE_CLIENT_ID!,
  CLIENT_SECRET: GOOGLE_CLIENT_SECRET!,
  REDIRECT_URI: GOOGLE_REDIRECT_URI!,
};

router.get('/oauth2/google/initiate', (req: express.Request, res: express.Response) => {
  const rawState = (req.query.state as string) || '';
  const signedState = signJwt({ p: 'google', s: rawState, ts: Date.now() }, JWT_SECRET, { expiresInSec: 600 });
  const url = buildGoogleAuthUrl({ clientId: GOOGLE_ENV.CLIENT_ID, clientSecret: GOOGLE_ENV.CLIENT_SECRET, redirectUri: GOOGLE_ENV.REDIRECT_URI }, signedState);
  res.json({ url });
});

router.get('/oauth2/google/callback', async (req: express.Request, res: express.Response) => {
  const code = req.query.code as string;
  if (!code) return res.status(400).json({ error: 'Missing code' });
  try {
    const stateToken = String(req.query.state || '');
    const payload = stateToken ? verifyJwt(stateToken, JWT_SECRET) : null;
    if (!payload || payload.p !== 'google') {
      return res.status(400).json({ error: 'Invalid or expired state' });
    }
    const tokens = await exchangeGoogleCode({ clientId: GOOGLE_ENV.CLIENT_ID, clientSecret: GOOGLE_ENV.CLIENT_SECRET, redirectUri: GOOGLE_ENV.REDIRECT_URI }, code);
    // Fetch user info to get email via shared helper
    const me = await getGoogleUserInfo(tokens.accessToken);
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
import { getOutlookAuthUrl, getOutlookTokens, getOutlookUserInfo } from './oauth-outlook';

const OUTLOOK_ENV = {
  CLIENT_ID: OUTLOOK_CLIENT_ID!,
  CLIENT_SECRET: OUTLOOK_CLIENT_SECRET!,
  REDIRECT_URI: OUTLOOK_REDIRECT_URI!,
};

router.get('/oauth2/outlook/initiate', async (req: express.Request, res: express.Response) => {
  const rawState = (req.query.state as string) || '';
  try {
    const signedState = signJwt({ p: 'outlook', s: rawState, ts: Date.now() }, JWT_SECRET, { expiresInSec: 600 });
    const url = await getOutlookAuthUrl(OUTLOOK_ENV.CLIENT_ID, OUTLOOK_ENV.CLIENT_SECRET, OUTLOOK_ENV.REDIRECT_URI, signedState);
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate Outlook OAuth2 URL' });
  }
});

router.get('/oauth2/outlook/callback', async (req: express.Request, res: express.Response) => {
  const code = req.query.code as string;
  if (!code) return res.status(400).json({ error: 'Missing code' });
  try {
    const stateToken = String(req.query.state || '');
    const payload = stateToken ? verifyJwt(stateToken, JWT_SECRET) : null;
    if (!payload || payload.p !== 'outlook') {
      return res.status(400).json({ error: 'Invalid or expired state' });
    }
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
      const me = await getOutlookUserInfo(accessToken);
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
