import express from 'express';
import logger from '../services/logger';
import { requireContext, requireUid } from '../utils/repo-access';
import { CORS_ORIGIN } from '../config';
import type { Account, AccountPublic } from '../../shared/types';
import { createAccount, isUuidV4 } from '../../shared/constructors';
import { errorHandler, ValidationError, NotFoundError } from '../services/error-handler';
import { newId } from '../utils/id';
import {
  listAccounts,
  upsertAccount,
  updateAccountPartial as svcUpdateAccountPartial,
  deleteAccount as svcDeleteAccount,
  refreshAccount,
  gmailTest,
  outlookTest,
} from '../services/accounts';
import {
  initiateGoogleAccountOAuth,
  handleGoogleAccountCallback,
} from '../auth/oidc/flows';

 // Redact sensitive token values before sending to clients (DTO)
 function toAccountPublic(a: Account): AccountPublic {
   return {
     id: a.id,
     provider: a.provider,
     email: a.email,
     signature: a.signature,
     tokens: {
       accessToken: a.tokens.accessToken ? 'REDACTED' : '',
       refreshToken: a.tokens.refreshToken ? 'REDACTED' : '',
       expiry: a.tokens.expiry,
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
    const context = requireContext(req);
    const account = await handleGoogleAccountCallback(code, stateToken, cookieHeader, context);
    logger.info('Google account callback completed', { accountId: account.id, email: account.email });
    const origin = (CORS_ORIGIN && CORS_ORIGIN !== '*') ? CORS_ORIGIN : '';
    const location = (origin && origin.trim()) ? origin : '/';
    res.redirect(location);
  }));

  app.get('/api/accounts', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const context = requireContext(req);
    const accounts = await listAccounts(context);
    logger.info('Loaded accounts', { count: accounts.length, uid: requireUid(context) });
    const sanitized: AccountPublic[] = accounts.map(toAccountPublic);
    res.json(sanitized);
  }));

  app.get('/api/accounts/:id/outlook-test', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    logger.info('GET /api/accounts/:id/outlook-test invoked', { id });
    const result = await outlookTest(requireContext(req), id);
    res.json(result);
  }));

  app.post('/api/accounts', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    if (!req.body || typeof req.body !== 'object') {
      throw new ValidationError('Request body must be a JSON object', 'ACCOUNT_BODY_MISSING');
    }
    const payload = req.body as Record<string, unknown>;

    const rawId = typeof payload.id === 'string' ? payload.id.trim() : '';
    if (rawId && !isUuidV4(rawId)) {
      throw new ValidationError('id must be a UUID v4 when provided', 'ACCOUNT_ID_INVALID');
    }
    const provider = typeof payload.provider === 'string' ? payload.provider.trim() : '';
    const email = typeof payload.email === 'string' ? payload.email.trim() : '';
    if (!provider || !email) {
      throw new ValidationError('provider and email are required', 'ACCOUNT_FIELDS_MISSING');
    }
    if (payload.signature == null || typeof payload.signature !== 'string') {
      throw new ValidationError('signature is required', 'ACCOUNT_SIGNATURE_MISSING');
    }
    if (!payload.tokens || typeof payload.tokens !== 'object') {
      throw new ValidationError('tokens object is required', 'ACCOUNT_TOKENS_MISSING');
    }
    const tokens = payload.tokens as Record<string, unknown>;
    const requiredTokenFields = ['accessToken', 'refreshToken', 'expiry'] as const;
    for (const key of requiredTokenFields) {
      const value = tokens[key];
      if (typeof value !== 'string' || !value.trim()) {
        throw new ValidationError(`tokens.${key} is required`, 'ACCOUNT_TOKEN_FIELD_MISSING');
      }
    }

    const id = rawId || newId();
    payload.id = id;

    const newAccount: Account = createAccount(payload as any);
    const context = requireContext(req);
    await upsertAccount(context, newAccount);
    const source = `user ${requireUid(context)}`;
    logger.info('Saved accounts to store', { source, id: newAccount.id, provider: newAccount.provider });
    res.json({ success: true, id: newAccount.id });
  }));

  app.put('/api/accounts/:id', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    try {
      // Preserve existing sensitive fields; only allow updating safe fields (currently: signature)
      const context = requireContext(req);
      const existing = (await listAccounts(context)).find(a => a.id === id);
      if (!existing) {
        throw new NotFoundError('Account not found');
      }
      const payload = req.body;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new ValidationError('Request body must be a JSON object', 'ACCOUNT_UPDATE_BODY_INVALID');
      }
      const signatureRaw = (payload as any).signature;
      if (typeof signatureRaw !== 'string' || !signatureRaw.trim()) {
        throw new ValidationError('signature is required and must be a non-empty string', 'ACCOUNT_SIGNATURE_MISSING');
      }
      const patch = { signature: signatureRaw.trim() };
      await svcUpdateAccountPartial(context, id, patch);
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
      const context = requireContext(req);
      const { revokeStatus, revokeError } = await svcDeleteAccount(context, id);
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
    const svcResult = await refreshAccount(requireContext(req), id);
    if (!svcResult.ok) {
      const payload: any = {
        ok: false,
        error: svcResult.error ?? 'refresh_failed',
        provider: svcResult.provider
      };
      if (svcResult.reauthRequired) {
        payload.reauthRequired = true;
        payload.reauth = {
          provider: svcResult.provider,
          accountId: id
        };
      }
      return res.json(payload);
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
    const result = await gmailTest(requireContext(req), id);
    res.json(result);
  }));
}
