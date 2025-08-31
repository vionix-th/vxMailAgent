import express from 'express';
import { Account } from '../../shared/types';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, OUTLOOK_REDIRECT_URI, JWT_SECRET } from '../config';
import { signJwt, verifyJwt } from '../utils/jwt';
import { UserRequest, getUserContext } from '../middleware/user-context';
import { buildGoogleAuthUrl, exchangeGoogleCode, getGoogleUserInfo } from '../oauth/google';
import { getOutlookAuthUrl, getOutlookTokens, getOutlookUserInfo } from '../oauth-outlook';
import { computeExpiryISO } from '../oauth/common';
import logger from '../services/logger';
import { requireReq, repoGetAll, repoSetAll } from '../utils/repo-access';

/**
 * Gets accounts from the per-user repository (user context required).
 */
function getAccounts(req: UserRequest): Account[] {
  const ureq = requireReq(req);
  return repoGetAll<Account>(ureq, 'accounts');
}

/**
 * Saves accounts to the per-user repository (user context required).
 */
function saveAccounts(req: UserRequest, accounts: Account[]): void {
  const ureq = requireReq(req);
  repoSetAll<Account>(ureq, 'accounts', accounts);
}

/** Register routes for managing accounts and tokens. */
export default function registerAccountsRoutes(app: express.Express) {
  // OAuth (Connect account) - Google
  app.get('/api/accounts/oauth/google/initiate', (req: express.Request, res: express.Response) => {
    try {
      const rawState = String(req.query.state || '');
      const signedState = signJwt({ p: 'google.account', s: rawState, ts: Date.now() }, JWT_SECRET, { expiresInSec: 600 });
      const url = buildGoogleAuthUrl(
        { clientId: GOOGLE_CLIENT_ID!, clientSecret: GOOGLE_CLIENT_SECRET!, redirectUri: GOOGLE_REDIRECT_URI! },
        signedState
      );
      res.json({ url });
    } catch (e) {
      res.status(500).json({ error: 'Failed to generate Google OAuth2 URL' });
    }
  });

  app.get('/api/accounts/oauth/google/callback', async (req: UserRequest, res: express.Response) => {
    const code = String((req.query as any).code || '');
    const stateToken = String((req.query as any).state || '');
    if (!code) return res.status(400).json({ error: 'Missing code' });
    try {
      const payload = stateToken ? verifyJwt(stateToken, JWT_SECRET) : null;
      if (!payload || payload.p !== 'google.account') return res.status(400).json({ error: 'Invalid or expired state' });
      const tokens = await exchangeGoogleCode({ clientId: GOOGLE_CLIENT_ID!, clientSecret: GOOGLE_CLIENT_SECRET!, redirectUri: GOOGLE_REDIRECT_URI! }, code);
      const me = await getGoogleUserInfo(tokens.accessToken);
      const email = me?.email || '';
      if (!email) return res.status(500).json({ error: 'Google profile missing email address' });
      const account: Account = {
        id: email,
        provider: 'gmail',
        email,
        signature: '',
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken || '',
          expiry: tokens.expiryISO,
        },
      } as any;
      const accounts = getAccounts(req);
      const idx = accounts.findIndex(a => a.id === account.id);
      if (idx >= 0) accounts[idx] = account; else accounts.push(account);
      saveAccounts(req, accounts);
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

  // OAuth (Connect account) - Outlook
  app.get('/api/accounts/oauth/outlook/initiate', async (req: express.Request, res: express.Response) => {
    try {
      const rawState = String(req.query.state || '');
      const signedState = signJwt({ p: 'outlook.account', s: rawState, ts: Date.now() }, JWT_SECRET, { expiresInSec: 600 });
      const url = await getOutlookAuthUrl(
        OUTLOOK_CLIENT_ID!,
        OUTLOOK_CLIENT_SECRET!,
        OUTLOOK_REDIRECT_URI!,
        signedState
      );
      res.json({ url });
    } catch (e) {
      res.status(500).json({ error: 'Failed to generate Outlook OAuth2 URL' });
    }
  });

  app.get('/api/accounts/oauth/outlook/callback', async (req: UserRequest, res: express.Response) => {
    const code = String((req.query as any).code || '');
    const stateToken = String((req.query as any).state || '');
    if (!code) return res.status(400).json({ error: 'Missing code' });
    try {
      const payload = stateToken ? verifyJwt(stateToken, JWT_SECRET) : null;
      if (!payload || payload.p !== 'outlook.account') return res.status(400).json({ error: 'Invalid or expired state' });
      const tokenResponse = await getOutlookTokens(OUTLOOK_CLIENT_ID!, OUTLOOK_CLIENT_SECRET!, OUTLOOK_REDIRECT_URI!, code);
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
      const account: Account = {
        id: email,
        provider: 'outlook',
        email,
        signature: '',
        tokens: {
          accessToken: tokenResponse?.access_token || '',
          refreshToken: tokenResponse?.refresh_token || '',
          expiry: expiryIso,
        },
      } as any;
      const accounts = getAccounts(req);
      const idx = accounts.findIndex(a => a.id === account.id);
      if (idx >= 0) accounts[idx] = account; else accounts.push(account);
      saveAccounts(req, accounts);
      res.json({ account });
    } catch (e) {
      res.status(500).json({ error: 'Outlook OAuth2 callback failed' });
    }
  });
  app.get('/api/accounts', (req: UserRequest, res) => {
    try {
      const ureq = requireReq(req);
      const accounts = getAccounts(ureq);
      logger.info('Loaded accounts', { count: accounts.length, uid: getUserContext(ureq).uid });
      res.json(accounts);
    } catch (e) {
      logger.error('Error loading accounts', { err: e });
      res.status(500).json({ error: 'Failed to load accounts' });
    }
  });
  app.get('/api/accounts/:id/outlook-test', async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    logger.info('GET /api/accounts/:id/outlook-test invoked', { id });
    try {
      if (!OUTLOOK_CLIENT_ID || !OUTLOOK_CLIENT_SECRET) {
        return res.status(400).json({ error: 'Missing Outlook OAuth env vars (OUTLOOK_CLIENT_ID/OUTLOOK_CLIENT_SECRET)' });
      }
      const accounts = getAccounts(req as UserRequest);
      if (accounts.length === 0) {
        return res.status(404).json({ error: 'no accounts found' });
      }
      const idx = accounts.findIndex(a => a.id === id);
      if (idx === -1) return res.status(404).json({ error: 'account not found' });
      const account = accounts[idx];
      if (account.provider !== 'outlook') {
        return res.status(400).json({ error: 'Only outlook supported for this test' });
      }
      const { ensureValidOutlookAccessToken } = require('../oauth-outlook');
      const result = await ensureValidOutlookAccessToken(
        account,
        OUTLOOK_CLIENT_ID!,
        OUTLOOK_CLIENT_SECRET!
      );
      if (result.error) {
        if (String(result.error).toLowerCase().includes('missing refresh token')) {
          try {
            const { getOutlookAuthUrl } = require('../oauth-outlook');
            const rawState = `reauth:${id}`;
            const signedState = signJwt({ p: 'outlook', s: rawState, ts: Date.now() }, JWT_SECRET, { expiresInSec: 600 });
            const url = await getOutlookAuthUrl(
              OUTLOOK_CLIENT_ID!,
              OUTLOOK_CLIENT_SECRET!,
              OUTLOOK_REDIRECT_URI!,
              signedState
            );
            return res.json({ ok: false, error: 'missing_refresh_token', authorizeUrl: url });
          } catch (e) {
            logger.error('Failed to generate Outlook re-auth URL', { id, err: e });
            return res.status(500).json({ ok: false, error: result.error });
          }
        }
        logger.error('Outlook test refresh failed', { id, error: result.error });
        return res.status(500).json({ ok: false, error: result.error });
      }
      if (result.updated) {
        account.tokens.accessToken = result.accessToken;
        account.tokens.expiry = result.expiry;
        account.tokens.refreshToken = result.refreshToken;
        accounts[idx] = account;
        saveAccounts(req as UserRequest, accounts);
        logger.info('Refreshed + persisted during outlook-test', { id });
      }

      const doGet = (path: string) => new Promise<any>((resolve, reject) => {
        const https = require('https');
        const req = https.request({
          method: 'GET',
          hostname: 'graph.microsoft.com',
          path,
          headers: { Authorization: `Bearer ${account.tokens.accessToken}` },
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
        req.on('error', (err: any) => reject(err));
        req.end();
      });

      const me = await doGet('/v1.0/me');
      const messages = await doGet('/v1.0/me/messages?$top=1');
      res.json({
        ok: true,
        me: { userPrincipalName: me.userPrincipalName, mail: me.mail, id: me.id },
        sampleMessageId: Array.isArray(messages?.value) && messages.value.length > 0 ? messages.value[0].id : undefined,
        tokenExpiry: account.tokens.expiry,
      });
    } catch (e) {
      logger.error('Exception in GET /api/accounts/:id/outlook-test', { id, err: e });
      res.status(500).json({ error: (e as any)?.message || String(e) });
    }
  });
  app.post('/api/accounts', (req: UserRequest, res) => {
    try {
      const newAccount: Account = req.body;
      const ureq = requireReq(req);
      const accounts = getAccounts(ureq);
      const idx = accounts.findIndex(a => a.id === newAccount.id);
      
      if (idx >= 0) {
        logger.info('Updating existing account', { email: newAccount.email });
        accounts[idx] = newAccount;
      } else {
        logger.info('Adding new account', { email: newAccount.email });
        accounts.push(newAccount);
      }
      
      saveAccounts(ureq, accounts);
      const source = `user ${getUserContext(ureq).uid}`;
      logger.info('Saved accounts to store', { count: accounts.length, source });
      res.json({ success: true });
    } catch (e) {
      logger.error('Error saving account', { err: e });
      res.status(500).json({ error: 'Failed to save account' });
    }
  });
  app.put('/api/accounts/:id', (req: UserRequest, res: express.Response) => {
    try {
      const id = req.params.id;
      const accounts = getAccounts(req);
      const idx = accounts.findIndex(a => a.id === id);
      
      if (idx === -1) {
        return res.status(404).json({ error: 'Account not found' });
      }
      
      accounts[idx] = req.body;
      saveAccounts(req, accounts);
      logger.info('Updated account', { id });
      res.json({ success: true });
    } catch (e) {
      logger.error('Error updating account', { err: e });
      res.status(500).json({ error: 'Failed to update account' });
    }
  });
  app.delete('/api/accounts/:id', async (req: express.Request, res: express.Response) => {
    logger.debug('DELETE /api/accounts/:id invoked', { id: req.params.id });
    try {
      const id = req.params.id;
      const accounts = getAccounts(req as UserRequest);
      const idx = accounts.findIndex(a => a.id === id);
      if (idx === -1) {
        return res.status(404).json({ error: 'Account not found' });
      }
      const account = accounts[idx];
      let revokeStatus: boolean | undefined = undefined;
      let revokeError: string | undefined = undefined;
      if (account.provider === 'gmail' && account.tokens && account.tokens.refreshToken) {
        logger.debug('Attempting to revoke Google refresh token', { email: account.email });
        try {
          const { revokeGoogleToken } = require('../oauth/google');
          revokeStatus = await revokeGoogleToken(account.tokens.refreshToken);
          if (!revokeStatus) {
            revokeError = 'Failed to revoke Google refresh token.';
            logger.warn('Failed to revoke Google token', { email: account.email });
          } else {
            logger.info('Successfully revoked Google token', { email: account.email });
          }
        } catch (e) {
          revokeStatus = false;
          revokeError = e instanceof Error ? e.message : String(e);
          logger.error('Error revoking Google token', { email: account.email, err: e });
        }
      }
      if (account.provider === 'outlook' && account.tokens && account.tokens.refreshToken) {
        logger.debug('Attempting to revoke Outlook refresh token', { email: account.email });
        try {
          const { revokeOutlookToken } = require('../oauth-outlook');
          const ok = await revokeOutlookToken(account.tokens.refreshToken);
          if (!ok) {
            logger.warn('Failed to revoke Outlook token', { email: account.email });
          } else {
            logger.info('Successfully revoked Outlook token', { email: account.email });
          }
        } catch (e) {
          logger.error('Error revoking Outlook token', { email: account.email, err: e });
        }
      }
      const before = accounts.length;
      const filteredAccounts = accounts.filter(a => a.id !== id);
      saveAccounts(req as UserRequest, filteredAccounts);
      const after = filteredAccounts.length;
      logger.debug('Deleted account', { id, before, after });
      res.json({ success: true, revokeStatus, revokeError });
    } catch (e) {
      let revokeStatus: boolean | null = null;
      let revokeError: string | null = null;
      if (typeof (global as any).revokeStatus !== 'undefined') revokeStatus = (global as any).revokeStatus;
      if (typeof (global as any).revokeError !== 'undefined') revokeError = (global as any).revokeError;
      logger.error('Exception in DELETE /api/accounts/:id', { id: req.params.id, err: e, revokeStatus, revokeError });
      res.status(500).json({ error: e instanceof Error ? e.message : String(e), details: e, revokeStatus, revokeError });
    }
  });
  app.post('/api/accounts/:id/refresh', async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    logger.info('POST /api/accounts/:id/refresh invoked', { id });
    try {
      const accounts = getAccounts(req as UserRequest);
      if (accounts.length === 0) {
        return res.status(404).json({ error: 'no accounts found' });
      }
      const idx = accounts.findIndex(a => a.id === id);
      if (idx === -1) return res.status(404).json({ error: 'account not found' });
      const account = accounts[idx];
      if (account.provider === 'gmail') {
        const { ensureValidGoogleAccessToken } = require('../oauth/google');
        const result = await ensureValidGoogleAccessToken(
          account,
          GOOGLE_CLIENT_ID!,
          GOOGLE_CLIENT_SECRET!,
          GOOGLE_REDIRECT_URI!
        );
        if (result.error) {
          const errTxt = String(result.error || '');
          const missing = /missing refresh token/i.test(errTxt);
          const invalidGrant = /invalid_grant/i.test(errTxt) || /expired or revoked/i.test(errTxt);
          const network = /(ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|network)/i.test(errTxt);
          const category = missing ? 'missing_refresh_token' : invalidGrant ? 'invalid_grant' : network ? 'network' : 'other';
          logger.error('Google refresh failed', { area: 'oauth', provider: 'google', op: 'refresh', accountId: id, email: account.email, category, error: errTxt });
          if (missing || invalidGrant) {
            try {
              const { buildGoogleAuthUrl } = require('../oauth/google');
              const rawState = `reauth:${id}`;
              const signedState = signJwt({ p: 'google', s: rawState, ts: Date.now() }, JWT_SECRET, { expiresInSec: 600 });
              const url = buildGoogleAuthUrl(
                { clientId: GOOGLE_CLIENT_ID!, clientSecret: GOOGLE_CLIENT_SECRET!, redirectUri: GOOGLE_REDIRECT_URI! },
                signedState
              );
              return res.status(400).json({ ok: false, error: category, authorizeUrl: url });
            } catch (e) {
              logger.error('Failed to generate Google re-auth URL', { id, err: e });
              return res.status(500).json({ ok: false, error: errTxt });
            }
          }
          return res.status(500).json({ ok: false, error: errTxt });
        }
        if (result.updated) {
          account.tokens.accessToken = result.accessToken;
          account.tokens.expiry = result.expiry;
          account.tokens.refreshToken = result.refreshToken;
          accounts[idx] = account;
          saveAccounts(req as UserRequest, accounts);
          logger.info('Refreshed + persisted Gmail access token', { id });
        }
        return res.json({ ok: true, updated: result.updated, tokens: account.tokens });
      } else if (account.provider === 'outlook') {
        if (!OUTLOOK_CLIENT_ID || !OUTLOOK_CLIENT_SECRET) {
          return res.status(400).json({ error: 'Missing Outlook OAuth env vars (OUTLOOK_CLIENT_ID/OUTLOOK_CLIENT_SECRET)' });
        }
        const { ensureValidOutlookAccessToken } = require('../oauth-outlook');
        const result = await ensureValidOutlookAccessToken(
          account,
          OUTLOOK_CLIENT_ID!,
          OUTLOOK_CLIENT_SECRET!
        );
        if (result.error) {
          if (String(result.error).toLowerCase().includes('missing refresh token')) {
            try {
              const { getOutlookAuthUrl } = require('../oauth-outlook');
              const state = `reauth:${id}`;
              const url = await getOutlookAuthUrl(
                OUTLOOK_CLIENT_ID!,
                OUTLOOK_CLIENT_SECRET!,
                OUTLOOK_REDIRECT_URI!,
                state
              );
              return res.json({ ok: false, error: 'missing_refresh_token', authorizeUrl: url });
            } catch (e) {
              logger.error('Failed to generate Outlook re-auth URL', { id, err: e });
              return res.status(500).json({ ok: false, error: result.error });
            }
          }
          logger.error('Outlook refresh failed', { id, error: result.error });
          return res.status(500).json({ ok: false, error: result.error });
        }
        if (result.updated) {
          account.tokens.accessToken = result.accessToken;
          account.tokens.expiry = result.expiry;
          account.tokens.refreshToken = result.refreshToken;
          accounts[idx] = account;
          saveAccounts(req as UserRequest, accounts);
          logger.info('Refreshed + persisted Outlook access token', { id });
        }
        return res.json({ ok: true, updated: result.updated, tokens: account.tokens });
      } else {
        return res.status(400).json({ error: 'Unknown provider' });
      }
    } catch (e) {
      logger.error('Exception in POST /api/accounts/:id/refresh', { id, err: e });
      res.status(500).json({ error: 'Refresh failed' });
    }
  });
  app.get('/api/accounts/:id/gmail-test', async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    logger.info('GET /api/accounts/:id/gmail-test invoked', { id });
    try {
      if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
        return res.status(400).json({ error: 'Missing Google OAuth env vars (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REDIRECT_URI)' });
      }
      const accounts = getAccounts(req as UserRequest);
      const idx = accounts.findIndex(a => a.id === id);
      if (idx === -1) return res.status(404).json({ error: 'account not found' });
      const account = accounts[idx];
      if (account.provider !== 'gmail') {
        return res.status(400).json({ error: 'Only gmail supported for this test' });
      }
      const { ensureValidGoogleAccessToken } = require('../oauth/google');
      const result = await ensureValidGoogleAccessToken(
        account,
        GOOGLE_CLIENT_ID!,
        GOOGLE_CLIENT_SECRET!,
        GOOGLE_REDIRECT_URI!
      );
      if (result.error) {
        const errTxt = String(result.error || '');
        const missing = /missing refresh token/i.test(errTxt);
        const invalidGrant = /invalid_grant/i.test(errTxt) || /expired or revoked/i.test(errTxt);
        const network = /(ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|network)/i.test(errTxt);
        const category = missing ? 'missing_refresh_token' : invalidGrant ? 'invalid_grant' : network ? 'network' : 'other';
        logger.error('Gmail test failed', { area: 'oauth', provider: 'google', op: 'gmail-test', accountId: id, email: account.email, category, error: errTxt });
        if (missing || invalidGrant) {
          try {
            const { buildGoogleAuthUrl } = require('../oauth/google');
            const rawState = `reauth:${id}`;
            const signedState = signJwt({ p: 'google', s: rawState, ts: Date.now() }, JWT_SECRET, { expiresInSec: 600 });
            const url = buildGoogleAuthUrl(
              { clientId: GOOGLE_CLIENT_ID!, clientSecret: GOOGLE_CLIENT_SECRET!, redirectUri: GOOGLE_REDIRECT_URI! },
              signedState
            );
            logger.info('gmail-test reauth_url_issued', { area: 'oauth', provider: 'google', op: 'gmail-test', accountId: id, email: account.email, action: 'reauth_url_issued', category, state: rawState });
            return res.json({ ok: false, error: category, authorizeUrl: url });
          } catch (e) {
            logger.error('Failed to generate Google re-auth URL', { id, err: e });
            return res.status(500).json({ ok: false, error: errTxt });
          }
        }
        return res.status(500).json({ ok: false, error: errTxt });
      }
      if (result.updated) {
        account.tokens.accessToken = result.accessToken;
        account.tokens.expiry = result.expiry;
        account.tokens.refreshToken = result.refreshToken;
        accounts[idx] = account;
        saveAccounts(req as UserRequest, accounts);
        logger.info('Refreshed + persisted during gmail-test', { id });
      }
      const { google } = require('googleapis');
      const oauth2Client = new (require('googleapis').google.auth.OAuth2)(
        GOOGLE_CLIENT_ID!,
        GOOGLE_CLIENT_SECRET!,
        GOOGLE_REDIRECT_URI!
      );
      oauth2Client.setCredentials({ access_token: account.tokens.accessToken });
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: 'me' });
      res.json({
        ok: true,
        emailAddress: profile.data.emailAddress,
        messagesTotal: profile.data.messagesTotal,
        threadsTotal: profile.data.threadsTotal,
        historyId: profile.data.historyId,
        tokenExpiry: account.tokens.expiry,
      });
    } catch (e) {
      logger.error('Exception in GET /api/accounts/:id/gmail-test', { id, err: e });
      res.status(500).json({ error: (e as any)?.message || String(e) });
    }
  });
}
