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
  initiateGoogleAccountOAuth,
  initiateOutlookAccountOAuth,
  handleGoogleAccountCallback,
  handleOutlookAccountCallback,
  gmailTest,
  outlookTest,
} from '../services/accounts';

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
  app.get('/api/accounts/oauth/google/initiate', errorHandler.wrapAsync((req: express.Request, res: express.Response) => {
    const rawState = String(req.query.state || '');
    const url = initiateGoogleAccountOAuth(rawState);
    res.json({ url });
  }));

  app.get('/api/accounts/oauth/google/callback', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const code = String((req.query as any).code || '');
    const stateToken = String((req.query as any).state || '');
    if (!code) throw new ValidationError('Missing code');
    await handleGoogleAccountCallback(code, stateToken, req as ReqLike);
    const origin = (CORS_ORIGIN && CORS_ORIGIN !== '*') ? CORS_ORIGIN : '';
    const location = origin || '/';
    res.redirect(location);
  }));

  // OAuth (Connect account) - Outlook
  app.get('/api/accounts/oauth/outlook/initiate', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const rawState = String(req.query.state || '');
    const url = await initiateOutlookAccountOAuth(rawState);
    res.json({ url });
  }));

  app.get('/api/accounts/oauth/outlook/callback', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const code = String((req.query as any).code || '');
    const stateToken = String((req.query as any).state || '');
    if (!code) throw new ValidationError('Missing code');
    await handleOutlookAccountCallback(code, stateToken, req as ReqLike);
    const origin = (CORS_ORIGIN && CORS_ORIGIN !== '*') ? CORS_ORIGIN : '';
    const location = origin || '/';
    res.redirect(location);
  }));

  app.get('/api/accounts', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const ureq = requireReq(req as ReqLike);
    const accounts = await listAccounts(ureq);
    logger.info('Loaded accounts', { count: accounts.length, uid: requireUid(ureq) });
    res.json(accounts);
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
      await svcUpdateAccount(req as ReqLike, id, req.body as Account);
    } catch (e: any) {
      if (String(e?.message || '').toLowerCase().includes('not found')) {
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
      if (String(e?.message || '').toLowerCase().includes('not found')) {
        throw new NotFoundError('Account not found');
      }
      throw e;
    }
  }));

  app.post('/api/accounts/:id/refresh', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    logger.info('POST /api/accounts/:id/refresh invoked', { id });
    const result = await refreshAccount(req as ReqLike, id);
    if (!result.ok) {
      // Map known errors to validation; others bubble as generic errors
      if (result.error === 'missing_refresh_token' || result.error === 'invalid_grant') {
        throw new ValidationError(`Refresh failed: ${result.error}`);
      }
      throw new Error(result.error || 'Refresh failed');
    }
    return res.json(result);
  }));

  app.get('/api/accounts/:id/gmail-test', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    logger.info('GET /api/accounts/:id/gmail-test invoked', { id });
    const result = await gmailTest(req as ReqLike, id);
    res.json(result);
  }));
}

