import express from 'express';
import * as persistence from '../persistence';
import { Account } from '../../shared/types';
import { ACCOUNTS_FILE } from '../utils/paths';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, OUTLOOK_REDIRECT_URI, JWT_SECRET } from '../config';
import { signJwt } from '../utils/jwt';


export default function registerAccountsRoutes(app: express.Express) {
  // GET /api/accounts
  app.get('/api/accounts', (_req, res) => {
    try {
      if (!require('fs').existsSync(ACCOUNTS_FILE)) {
        console.log(`[${new Date().toISOString()}] accounts.json.enc not found, returning empty account list`);
        return res.json([]);
      }
      const accounts = persistence.loadAndDecrypt(ACCOUNTS_FILE) as Account[];
      console.log(`[${new Date().toISOString()}] Loaded ${accounts.length} accounts from encrypted store`);
      res.json(accounts);
    } catch (e) {
      console.error(`[${new Date().toISOString()}] Error loading accounts:`, e);
      res.status(500).json({ error: 'Failed to load accounts' });
    }
  });

  // GET /api/accounts/:id/outlook-test
  app.get('/api/accounts/:id/outlook-test', async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    console.log(`[${new Date().toISOString()}] GET /api/accounts/${id}/outlook-test invoked`);
    try {
      if (!OUTLOOK_CLIENT_ID || !OUTLOOK_CLIENT_SECRET) {
        return res.status(400).json({ error: 'Missing Outlook OAuth env vars (OUTLOOK_CLIENT_ID/OUTLOOK_CLIENT_SECRET)' });
      }
      if (!require('fs').existsSync(ACCOUNTS_FILE)) {
        return res.status(404).json({ error: 'accounts store not found' });
      }
      const accounts = persistence.loadAndDecrypt(ACCOUNTS_FILE) as Account[];
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
        // Special-case: missing refresh token -> provide re-auth URL instead of hard error
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
            console.error(`[${new Date().toISOString()}] [OAUTH2] Failed to generate Outlook re-auth URL for ${id}:`, e);
            return res.status(500).json({ ok: false, error: result.error });
          }
        }
        console.error(`[${new Date().toISOString()}] [OAUTH2] Outlook test refresh failed for ${id}: ${result.error}`);
        return res.status(500).json({ ok: false, error: result.error });
      }
      if (result.updated) {
        account.tokens.accessToken = result.accessToken;
        account.tokens.expiry = result.expiry;
        account.tokens.refreshToken = result.refreshToken;
        accounts[idx] = account;
        persistence.encryptAndPersist(accounts, ACCOUNTS_FILE);
        console.log(`[${new Date().toISOString()}] [OAUTH2] Refreshed + persisted during outlook-test for ${id}`);
      }

      // Call Microsoft Graph: me and one message sample
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
      console.error(`[${new Date().toISOString()}] Exception in GET /api/accounts/${id}/outlook-test:`, e);
      res.status(500).json({ error: (e as any)?.message || String(e) });
    }
  });

  // POST /api/accounts
  app.post('/api/accounts', (req, res) => {
    try {
      const newAccount: Account = req.body;
      let accounts: Account[] = [];
      if (require('fs').existsSync(ACCOUNTS_FILE)) {
        accounts = persistence.loadAndDecrypt(ACCOUNTS_FILE);
      }
      const idx = accounts.findIndex(a => a.id === newAccount.id);
      if (idx >= 0) {
        console.log(`[${new Date().toISOString()}] Updating existing account: ${newAccount.email}`);
        accounts[idx] = newAccount;
      } else {
        console.log(`[${new Date().toISOString()}] Adding new account: ${newAccount.email}`);
        accounts.push(newAccount);
      }
      persistence.encryptAndPersist(accounts, ACCOUNTS_FILE);
      console.log(`[${new Date().toISOString()}] Saved ${accounts.length} accounts to encrypted store`);
      res.json({ success: true });
    } catch (e) {
      console.error(`[${new Date().toISOString()}] Error saving account:`, e);
      res.status(500).json({ error: 'Failed to save account' });
    }
  });

  // PUT /api/accounts/:id
  app.put('/api/accounts/:id', (req: express.Request, res: express.Response) => {
    try {
      const id = req.params.id;
      let accounts: Account[] = [];
      if (require('fs').existsSync(ACCOUNTS_FILE)) {
        accounts = persistence.loadAndDecrypt(ACCOUNTS_FILE);
      }
      const idx = accounts.findIndex(a => a.id === id);
      if (idx === -1) {
        return res.status(404).json({ error: 'Account not found' });
      }
      accounts[idx] = req.body;
      persistence.encryptAndPersist(accounts, ACCOUNTS_FILE);
      console.log(`[${new Date().toISOString()}] PUT /api/accounts/${id}: updated`);
      res.json({ success: true });
    } catch (e) {
      console.error(`[${new Date().toISOString()}] Error updating account:`, e);
      res.status(500).json({ error: 'Failed to update account' });
    }
  });

  // DELETE /api/accounts/:id
  app.delete('/api/accounts/:id', async (req: express.Request, res: express.Response) => {
    console.log(`[DEBUG] DELETE /api/accounts/${req.params.id} invoked`);
    try {
      const id = req.params.id;
      let accounts: Account[] = [];
      if (require('fs').existsSync(ACCOUNTS_FILE)) {
        accounts = persistence.loadAndDecrypt(ACCOUNTS_FILE);
      }
      const idx = accounts.findIndex(a => a.id === id);
      if (idx === -1) {
        return res.status(404).json({ error: 'Account not found' });
      }
      const account = accounts[idx];
      let revokeStatus: boolean | undefined = undefined;
      let revokeError: string | undefined = undefined;
      if (account.provider === 'gmail' && account.tokens && account.tokens.refreshToken) {
        console.log(`[DEBUG] Attempting to revoke Google refresh token for account ${account.email}`);
        try {
          const { revokeGoogleToken } = require('../oauth/google');
          revokeStatus = await revokeGoogleToken(account.tokens.refreshToken);
          if (!revokeStatus) {
            revokeError = 'Failed to revoke Google refresh token.';
            console.warn(`[OAUTH2] Failed to revoke Google token for account ${account.email}`);
          } else {
            console.log(`[OAUTH2] Successfully revoked Google token for account ${account.email}`);
          }
        } catch (e) {
          revokeStatus = false;
          revokeError = e instanceof Error ? e.message : String(e);
          console.error(`[OAUTH2] Error revoking Google token for account ${account.email}:`, e);
        }
      }
      if (account.provider === 'outlook' && account.tokens && account.tokens.refreshToken) {
        console.log(`[DEBUG] Attempting to revoke Outlook refresh token for account ${account.email}`);
        try {
          const { revokeOutlookToken } = require('../oauth-outlook');
          const ok = await revokeOutlookToken(account.tokens.refreshToken);
          if (!ok) {
            console.warn(`[OAUTH2] Failed to revoke Outlook token for account ${account.email}`);
          } else {
            console.log(`[OAUTH2] Successfully revoked Outlook token for account ${account.email}`);
          }
        } catch (e) {
          console.error(`[OAUTH2] Error revoking Outlook token for account ${account.email}:`, e);
        }
      }
      const before = accounts.length;
      accounts = accounts.filter(a => a.id !== id);
      persistence.encryptAndPersist(accounts, ACCOUNTS_FILE);
      const after = accounts.length;
      console.log(`[DEBUG] Deleted account ${id}. Accounts before: ${before}, after: ${after}`);
      res.json({ success: true, revokeStatus, revokeError });
    } catch (e) {
      let revokeStatus: boolean | null = null;
      let revokeError: string | null = null;
      if (typeof (global as any).revokeStatus !== 'undefined') revokeStatus = (global as any).revokeStatus;
      if (typeof (global as any).revokeError !== 'undefined') revokeError = (global as any).revokeError;
      console.error(`[ERROR] Exception in DELETE /api/accounts/${req.params.id}:`, e);
      res.status(500).json({ error: e instanceof Error ? e.message : String(e), details: e, revokeStatus, revokeError });
    }
  });

  // POST /api/accounts/:id/refresh (Gmail)
  app.post('/api/accounts/:id/refresh', async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    console.log(`[${new Date().toISOString()}] POST /api/accounts/${id}/refresh invoked`);
    try {
      if (!require('fs').existsSync(ACCOUNTS_FILE)) {
        return res.status(404).json({ error: 'accounts store not found' });
      }
      const accounts = persistence.loadAndDecrypt(ACCOUNTS_FILE) as Account[];
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
          console.error(
            JSON.stringify({
              ts: new Date().toISOString(),
              level: 'error',
              area: 'oauth',
              provider: 'google',
              op: 'refresh',
              accountId: id,
              email: account.email,
              category,
              error: errTxt,
            })
          );
          account.tokens.refreshToken = result.refreshToken;
          accounts[idx] = account;
          persistence.encryptAndPersist(accounts, ACCOUNTS_FILE);
          console.log(`[${new Date().toISOString()}] [OAUTH2] Refreshed + persisted access token for ${id}`);
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
          // Special-case: missing refresh token -> provide re-auth URL to complete
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
              console.error(`[${new Date().toISOString()}] [OAUTH2] Failed to generate Outlook re-auth URL for ${id}:`, e);
              return res.status(500).json({ ok: false, error: result.error });
            }
          }
          console.error(`[${new Date().toISOString()}] [OAUTH2] Outlook refresh failed for ${id}: ${result.error}`);
          return res.status(500).json({ ok: false, error: result.error });
        }
        if (result.updated) {
          account.tokens.accessToken = result.accessToken;
          account.tokens.expiry = result.expiry;
          account.tokens.refreshToken = result.refreshToken;
          accounts[idx] = account;
          persistence.encryptAndPersist(accounts, ACCOUNTS_FILE);
          console.log(`[${new Date().toISOString()}] [OAUTH2] Refreshed + persisted Outlook access token for ${id}`);
        }
        return res.json({ ok: true, updated: result.updated, tokens: account.tokens });
      } else {
        return res.status(400).json({ error: 'Unknown provider' });
      }
    } catch (e) {
      console.error(`[${new Date().toISOString()}] Exception in POST /api/accounts/${id}/refresh:`, e);
      res.status(500).json({ error: 'Refresh failed' });
    }
  });

  // GET /api/accounts/:id/gmail-test
  app.get('/api/accounts/:id/gmail-test', async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    console.log(`[${new Date().toISOString()}] GET /api/accounts/${id}/gmail-test invoked`);
    try {
      if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
        return res.status(400).json({ error: 'Missing Google OAuth env vars (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REDIRECT_URI)' });
      }
      if (!require('fs').existsSync(ACCOUNTS_FILE)) {
        return res.status(404).json({ error: 'accounts store not found' });
      }
      const accounts = persistence.loadAndDecrypt(ACCOUNTS_FILE) as Account[];
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
        console.error(
          JSON.stringify({
            ts: new Date().toISOString(),
            level: 'error',
            area: 'oauth',
            provider: 'google',
            op: 'gmail-test',
            accountId: id,
            email: account.email,
            category,
            error: errTxt,
          })
        );
        // Special-case: missing refresh token or invalid_grant -> provide re-auth URL
        if (missing || invalidGrant) {
          try {
            const { buildGoogleAuthUrl } = require('../oauth/google');
            const rawState = `reauth:${id}`;
            const signedState = signJwt({ p: 'google', s: rawState, ts: Date.now() }, JWT_SECRET, { expiresInSec: 600 });
            const url = buildGoogleAuthUrl(
              { clientId: GOOGLE_CLIENT_ID!, clientSecret: GOOGLE_CLIENT_SECRET!, redirectUri: GOOGLE_REDIRECT_URI! },
              signedState
            );
            console.log(
              JSON.stringify({
                ts: new Date().toISOString(),
                level: 'info',
                area: 'oauth',
                provider: 'google',
                op: 'gmail-test',
                accountId: id,
                email: account.email,
                action: 'reauth_url_issued',
                category,
                state: rawState,
              })
            );
            return res.json({ ok: false, error: category, authorizeUrl: url });
          } catch (e) {
            console.error(`[${new Date().toISOString()}] [OAUTH2] Failed to generate Google re-auth URL for ${id}:`, e);
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
        persistence.encryptAndPersist(accounts, ACCOUNTS_FILE);
        console.log(`[${new Date().toISOString()}] [OAUTH2] Refreshed + persisted during gmail-test for ${id}`);
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
      console.error(`[${new Date().toISOString()}] Exception in GET /api/accounts/${id}/gmail-test:`, e);
      res.status(500).json({ error: (e as any)?.message || String(e) });
    }
  });
}
