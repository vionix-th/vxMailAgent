import express from 'express';
import logger from '../services/logger';
import { requireReq, requireUid } from '../utils/repo-access';
import { CORS_ORIGIN } from '../config';
import type { ReqLike } from '../interfaces';
import type { Account } from '../../shared/types';
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
  app.get('/api/accounts/oauth/google/initiate', (req: express.Request, res: express.Response) => {
    try {
      const rawState = String(req.query.state || '');
      const url = initiateGoogleAccountOAuth(rawState);
      res.json({ url });
    } catch (e) {
      res.status(500).json({ error: 'Failed to generate Google OAuth2 URL' });
    }
  });

  app.get('/api/accounts/oauth/google/callback', async (req, res: express.Response) => {
    const code = String((req.query as any).code || '');
    const stateToken = String((req.query as any).state || '');
    if (!code) return res.status(400).json({ error: 'Missing code' });
    try {
      await handleGoogleAccountCallback(code, stateToken, req as ReqLike);
      const origin = (CORS_ORIGIN && CORS_ORIGIN !== '*') ? CORS_ORIGIN : '';
      const location = origin || '/';
      res.redirect(location);
    } catch (e: any) {
      const message = e?.message || 'OAuth2 callback failed';
      const detail = e?.stack;
      res.status(500).json({ error: message, detail });
    }
  });

  // OAuth (Connect account) - Outlook
  app.get('/api/accounts/oauth/outlook/initiate', async (req: express.Request, res: express.Response) => {
    try {
      const rawState = String(req.query.state || '');
      const url = await initiateOutlookAccountOAuth(rawState);
      res.json({ url });
    } catch (e) {
      res.status(500).json({ error: 'Failed to generate Outlook OAuth2 URL' });
    }
  });

  app.get('/api/accounts/oauth/outlook/callback', async (req, res: express.Response) => {
    const code = String((req.query as any).code || '');
    const stateToken = String((req.query as any).state || '');
    if (!code) return res.status(400).json({ error: 'Missing code' });
    try {
      await handleOutlookAccountCallback(code, stateToken, req as ReqLike);
      const origin = (CORS_ORIGIN && CORS_ORIGIN !== '*') ? CORS_ORIGIN : '';
      const location = origin || '/';
      res.redirect(location);
    } catch (e) {
      res.status(500).json({ error: 'Outlook OAuth2 callback failed' });
    }
  });

  app.get('/api/accounts', async (req, res) => {
    try {
      const ureq = requireReq(req as ReqLike);
      const accounts = await listAccounts(ureq);
      logger.info('Loaded accounts', { count: accounts.length, uid: requireUid(ureq) });
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
      const result = await outlookTest(req as ReqLike, id);
      res.json(result);
    } catch (e: any) {
      logger.error('Exception in GET /api/accounts/:id/outlook-test', { id, err: e });
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  app.post('/api/accounts', async (req, res) => {
    try {
      const newAccount: Account = req.body;
      const ureq = requireReq(req as ReqLike);
      await upsertAccount(ureq, newAccount);
      const source = `user ${requireUid(ureq)}`;
      logger.info('Saved accounts to store', { source });
      res.json({ success: true });
    } catch (e) {
      logger.error('Error saving account', { err: e });
      res.status(500).json({ error: 'Failed to save account' });
    }
  });

  app.put('/api/accounts/:id', async (req, res: express.Response) => {
    try {
      const id = req.params.id;
      await svcUpdateAccount(req as ReqLike, id, req.body as Account);
      logger.info('Updated account', { id });
      res.json({ success: true });
    } catch (e: any) {
      if (String(e?.message || '').toLowerCase().includes('not found')) return res.status(404).json({ error: 'Account not found' });
      logger.error('Error updating account', { err: e });
      res.status(500).json({ error: 'Failed to update account' });
    }
  });

  app.delete('/api/accounts/:id', async (req: express.Request, res: express.Response) => {
    logger.debug('DELETE /api/accounts/:id invoked', { id: req.params.id });
    try {
      const id = req.params.id;
      const { revokeStatus, revokeError } = await svcDeleteAccount(req as ReqLike, id);
      res.json({ success: true, revokeStatus, revokeError });
    } catch (e: any) {
      if (String(e?.message || '').toLowerCase().includes('not found')) return res.status(404).json({ error: 'Account not found' });
      logger.error('Exception in DELETE /api/accounts/:id', { id: req.params.id, err: e });
      res.status(500).json({ error: e?.message || String(e), details: e });
    }
  });

  app.post('/api/accounts/:id/refresh', async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    logger.info('POST /api/accounts/:id/refresh invoked', { id });
    try {
      const result = await refreshAccount(req as ReqLike, id);
      if (!result.ok) {
        const code = (result.error === 'missing_refresh_token' || result.error === 'invalid_grant') ? 400 : 500;
        return res.status(code).json(result);
      }
      return res.json(result);
    } catch (e) {
      logger.error('Exception in POST /api/accounts/:id/refresh', { id, err: e });
      res.status(500).json({ error: 'Refresh failed' });
    }
  });

  app.get('/api/accounts/:id/gmail-test', async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    logger.info('GET /api/accounts/:id/gmail-test invoked', { id });
    try {
      const result = await gmailTest(req as ReqLike, id);
      res.json(result);
    } catch (e: any) {
      logger.error('Exception in GET /api/accounts/:id/gmail-test', { id, err: e });
      res.status(500).json({ error: e?.message || String(e) });
    }
  });
}

