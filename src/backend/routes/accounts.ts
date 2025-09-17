import express from 'express';
import logger from '../services/logger';
import { requireReq, requireUid } from '../utils/repo-access';
import { CORS_ORIGIN } from '../config';
import type { ReqLike } from '../interfaces';
import type { Account } from '../../shared/types';
import { errorHandler, ValidationError, NotFoundError } from '../services/error-handler';
import {
  listAccounts,
  upsertAccount,
  updateAccount as svcUpdateAccount,
  deleteAccount as svcDeleteAccount,
  refreshAccount,
  gmailTest,
  outlookTest,
} from '../services/accounts';
import {
  initiateGoogleAccountOAuth,
  handleGoogleAccountCallback,
} from '../auth/oidc/flows';

 // Redact sensitive token values before sending to clients.
 function sanitizeAccountForClient(a: Account): Account {
   return {
     ...a,
     tokens: {
       accessToken: a.tokens?.accessToken ? 'REDACTED' : '',
       refreshToken: a.tokens?.refreshToken ? 'REDACTED' : '',
      expiry: a.tokens?.expiry ?? '',
     },
   };
 }

/**
 * Gets accounts from the per-user repository (user context required).
 */
// Removed: now provided by services/accounts.ts (listAccounts)

/**
 * Saves accounts to the per-user repository (user context required).
 */
// Removed: mutation operations now handled by services/accounts.ts

/** Register routes for managing accounts and tokens. */
export default function registerAccountsRoutes(app: express.Express) {
  // OAuth (Connect account) - Google
  app.get('/api/accounts/oauth/google/initiate', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const rawState = String(req.query.state ?? '');
    const { url, loginCookie } = await initiateGoogleAccountOAuth(rawState);
    res.setHeader('Set-Cookie', loginCookie);
    res.json({ url });
  }));

  app.get('/api/accounts/oauth/google/callback', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const code = String((req.query as any).code ?? '');
    const stateToken = String((req.query as any).state ?? '');
    if (!code) throw new ValidationError('Missing code');
    const cookieHeader = typeof req.headers['cookie'] === 'string' ? req.headers['cookie'] : undefined;
    logger.info('Google account callback received', { code: code ? 'present' : 'missing', state: stateToken ? 'present' : 'missing' });
    const account = await handleGoogleAccountCallback(code, stateToken, cookieHeader, req as ReqLike);
    logger.info('Google account callback completed', { accountId: account.id, email: account.email });
    const origin = (CORS_ORIGIN && CORS_ORIGIN !== '*') ? CORS_ORIGIN : '';
    const location = origin ?? '/';
    res.redirect(location);
  }));

  // OAuth (Connect account) - Outlook - DISABLED: Legacy implementation removed
  // TODO: Implement Outlook account onboarding using OIDC+PKCE pattern

  app.get('/api/accounts', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const ureq = requireReq(req as ReqLike);
    const accounts = await listAccounts(ureq);
    logger.info('Loaded accounts', { count: accounts.length, uid: requireUid(ureq) });
    const sanitized = accounts.map(sanitizeAccountForClient);
    res.json(sanitized);
  }));

  app.get('/api/accounts/:id/outlook-test', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    logger.info('GET /api/accounts/:id/outlook-test invoked', { id });
    const result = await outlookTest(req as ReqLike, id);
    res.json(result);
  }));

  app.post('/api/accounts', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const newAccount: Account = req.body;
    const ureq = requireReq(req as ReqLike);
    await upsertAccount(ureq, newAccount);
    const source = `user ${requireUid(ureq)}`;
    logger.info('Saved accounts to store', { source });
    res.json({ success: true });
  }));

  app.put('/api/accounts/:id', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    try {
      // Preserve existing sensitive fields; only allow updating safe fields (currently: signature)
      const ureq = requireReq(req as ReqLike);
      const existing = (await listAccounts(ureq)).find(a => a.id === id);
      if (!existing) {
        throw new NotFoundError('Account not found');
      }
      const body = (req.body || {}) as Partial<Account>;
      const next: Account = {
        ...existing,
        signature: typeof body.signature === 'string' ? body.signature : existing.signature,
      } as Account;
      await svcUpdateAccount(req as ReqLike, id, next);
    } catch (e: any) {
      if (String(e?.message ?? '').toLowerCase().includes('not found')) {
        throw new NotFoundError('Account not found');
      }
      throw e;
    }
    logger.info('Updated account', { id });
    res.json({ success: true });
  }));

  app.delete('/api/accounts/:id', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    logger.debug('DELETE /api/accounts/:id invoked', { id: req.params.id });
    const id = req.params.id;
    try {
      const { revokeStatus, revokeError } = await svcDeleteAccount(req as ReqLike, id);
      res.json({ success: true, revokeStatus, revokeError });
    } catch (e: any) {
      if (String(e?.message ?? '').toLowerCase().includes('not found')) {
        throw new NotFoundError('Account not found');
      }
      throw e;
    }
  }));

  app.post('/api/accounts/:id/refresh', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    logger.info('POST /api/accounts/:id/refresh invoked', { id });
    const svcResult = await refreshAccount(req as ReqLike, id);
    if (!svcResult.ok) {
      // Map known errors to validation; others bubble as generic errors
      if (svcResult.error === 'missing_refresh_token' || svcResult.error === 'invalid_grant') {
        throw new ValidationError(`Refresh failed: ${svcResult.error}`);
      }
      throw new Error(svcResult.error ?? 'Refresh failed');
    }
    const result = svcResult && svcResult.tokens
      ? {
          ...svcResult,
          tokens: {
            accessToken: svcResult.tokens?.accessToken ? 'REDACTED' : '',
            refreshToken: svcResult.tokens?.refreshToken ? 'REDACTED' : '',
            expiry: svcResult.tokens?.expiry ?? '',
          },
        }
      : svcResult;
    return res.json(result);
  }));

  app.get('/api/accounts/:id/gmail-test', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    logger.info('GET /api/accounts/:id/gmail-test invoked', { id });
    const result = await gmailTest(req as ReqLike, id);
    res.json(result);
  }));
}
