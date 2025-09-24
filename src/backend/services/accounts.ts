import https from 'https';
import logger from './logger';
import { ValidationError } from './error-handler';
import { getGoogleOAuthConfig, getOutlookOAuthConfig } from '../config';
import { ensureValidGoogleAccessToken } from '../oauth/google';
import { ensureValidOutlookAccessToken, revokeOutlookToken } from '../oauth/outlook';
import { requireReq, requireUid, getAccountsRepo } from '../utils/repo-access';
import type { ReqLike } from '../interfaces';
import type { Account } from '../../shared/types';
import { revokeGoogleToken } from '../oauth/google';

// Data access helpers
export async function listAccounts(req: ReqLike): Promise<Account[]> {
  const ureq = requireReq(req);
  const repo = getAccountsRepo(ureq);
  const rows = await repo.list();
  return [...rows];
}

export async function upsertAccount(req: ReqLike, next: Account): Promise<void> {
  const ureq = requireReq(req);
  const repo = getAccountsRepo(ureq);
  if (typeof next?.id !== 'string' || !next.id.trim()) {
    throw new ValidationError('Account id required');
  }
  const existing = await repo.getById(next.id);
  if (existing) {
    await repo.update(next);
  } else {
    await repo.insert(next);
  }
  logger.info('Saved account', { id: next.id, uid: requireUid(ureq) });
}

export async function updateAccount(req: ReqLike, id: string, next: Account): Promise<void> {
  const ureq = requireReq(req);
  const repo = getAccountsRepo(ureq);
  const current = await repo.getById(id);
  if (!current) throw new Error('Account not found');

  if (next.id && next.id !== id) {
    throw new ValidationError('Account id mismatch');
  }
  next.id = id;

  await repo.update(next);
  logger.info('Updated account', { id });
}

/**
 * Partial update for Account allowing safe fields only (no token/id/provider changes).
 * Currently supports updating `signature`.
 */
export async function updateAccountPartial(
  req: ReqLike,
  id: string,
  patch: { signature?: string }
): Promise<void> {
  const ureq = requireReq(req);
  const repo = getAccountsRepo(ureq);
  const current = await repo.getById(id);
  if (!current) throw new Error('Account not found');

  if (typeof patch.signature === 'string') {
    current.signature = patch.signature;
  }
  await repo.update(current);
  logger.info('Updated account (partial)', { id, fields: Object.keys(patch).filter(k => (patch as any)[k] !== undefined) });
}

export async function deleteAccount(req: ReqLike, id: string): Promise<{ revokeStatus?: boolean; revokeError?: string }> {
  const ureq = requireReq(req);
  const repo = getAccountsRepo(ureq);
  const account = await repo.getById(id);
  if (!account) throw new Error('Account not found');

  let revokeStatus: boolean | undefined = undefined;
  let revokeError: string | undefined = undefined;

  try {
    if (account.provider === 'gmail' && account.tokens?.refreshToken) {
      logger.debug('Attempting to revoke Google refresh token', { email: account.email });
      revokeStatus = await revokeGoogleToken(account.tokens.refreshToken);
      if (!revokeStatus) revokeError = 'Failed to revoke Google refresh token.';
    }
    if (account.provider === 'outlook' && account.tokens?.refreshToken) {
      logger.debug('Attempting to revoke Outlook refresh token', { email: account.email });
      const ok = await revokeOutlookToken(account.tokens.refreshToken);
      revokeStatus = ok;
      if (!ok) revokeError = 'Failed to revoke Outlook refresh token.';
    }
  } catch (e: any) {
    revokeStatus = false;
    revokeError = e?.message || String(e);
  }

  const removed = await repo.delete(id);
  logger.debug('Deleted account', { id, removed });
  const resp: { revokeStatus?: boolean; revokeError?: string } = {};
  if (typeof revokeStatus === 'boolean') resp.revokeStatus = revokeStatus;
  if (typeof revokeError === 'string') resp.revokeError = revokeError;
  return resp;
}

// Legacy OAuth functions removed - now handled by auth/oidc/flows.ts

// Refresh tokens and provider tests
export async function refreshAccount(req: ReqLike, id: string): Promise<any> {
  const ureq = requireReq(req);
  const repo = getAccountsRepo(ureq);
  const account = await repo.getById(id);
  if (!account) throw new Error('account not found');

  if (account.provider === 'gmail') {
    const cfg = getGoogleOAuthConfig();
    try {
      const result = await ensureValidGoogleAccessToken(
        account.tokens,
        cfg
      );
      if (result.updated) {
        account.tokens.accessToken = result.accessToken;
        account.tokens.expiry = result.expiry;
        account.tokens.refreshToken = result.refreshToken;
        await repo.update(account);
        logger.info('Refreshed + persisted Gmail access token', { id });
      }
      return { ok: true, updated: result.updated, tokens: account.tokens };
    } catch (e: any) {
      const errTxt = String(e?.message || e);
      const missing = /missing refresh token/i.test(errTxt) || /OAUTH_MISSING_REFRESH_TOKEN/i.test(errTxt);
      const invalidGrant = /invalid_grant/i.test(errTxt) || /expired or revoked/i.test(errTxt);
      const network = /(ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|network)/i.test(errTxt);
      const category = missing ? 'missing_refresh_token' : invalidGrant ? 'invalid_grant' : network ? 'network' : 'other';
      logger.error('Google refresh failed', { area: 'oauth', provider: 'google', op: 'refresh', accountId: id, email: account.email, category, error: errTxt });
      if (missing || invalidGrant) {
        return { ok: false, error: category, reauthRequired: true };
      }
      return { ok: false, error: errTxt };
    }
  } else if (account.provider === 'outlook') {
    let cfg;
    try { cfg = getOutlookOAuthConfig(); }
    catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
    try {
      const result = await ensureValidOutlookAccessToken(
        account.tokens,
        cfg
      );
      if (result.updated) {
        account.tokens.accessToken = result.accessToken;
        account.tokens.expiry = result.expiry;
        account.tokens.refreshToken = result.refreshToken;
        await repo.update(account);
        logger.info('Refreshed + persisted Outlook access token', { id });
      }
      return { ok: true, updated: result.updated, tokens: account.tokens };
    } catch (e: any) {
      const errTxt = String(e?.message || e);
      if (/missing refresh token/i.test(errTxt) || /OAUTH_MISSING_REFRESH_TOKEN/i.test(errTxt)) {
        return { ok: false, error: 'missing_refresh_token', reauthRequired: true };
      }
      logger.error('Outlook refresh failed', { id, error: errTxt });
      return { ok: false, error: errTxt };
    }
  } else {
    return { ok: false, error: 'Unknown provider' };
  }
}

export async function outlookTest(req: ReqLike, id: string): Promise<any> {
  const cfg = getOutlookOAuthConfig();
  const ureq = requireReq(req);
  const repo = getAccountsRepo(ureq);
  const account = await repo.getById(id);
  if (!account) throw new Error('account not found');
  if (account.provider !== 'outlook') throw new Error('Only outlook supported for this test');

  let result: { accessToken: string; expiry: string; refreshToken: string; updated: boolean };
  try {
    result = await ensureValidOutlookAccessToken(
      account.tokens,
      cfg
    );
  } catch (e: any) {
    const errTxt = String(e?.message || e);
    if (/missing refresh token/i.test(errTxt) || /OAUTH_MISSING_REFRESH_TOKEN/i.test(errTxt)) {
      return { ok: false, error: 'missing_refresh_token', reauthRequired: true };
    }
    throw new Error(errTxt);
  }
  if (result.updated) {
    account.tokens.accessToken = result.accessToken;
    account.tokens.expiry = result.expiry;
    account.tokens.refreshToken = result.refreshToken;
    await repo.update(account);
    logger.info('Refreshed + persisted during outlook-test', { id });
  }

  const doGet = (path: string) => new Promise<any>((resolve, reject) => {
    const r = https.request({
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
    r.on('error', (err: any) => reject(err));
    r.end();
  });

  const me = await doGet('/v1.0/me');
  const messages = await doGet('/v1.0/me/messages?$top=1');
  return {
    ok: true,
    me: { userPrincipalName: me.userPrincipalName, mail: me.mail, id: me.id },
    sampleMessageId: Array.isArray(messages?.value) && messages.value.length > 0 ? messages.value[0].id : undefined,
    tokenExpiry: account.tokens.expiry,
  };
}

export async function gmailTest(req: ReqLike, id: string): Promise<any> {
  const cfg = getGoogleOAuthConfig();
  const ureq = requireReq(req);
  const repo = getAccountsRepo(ureq);
  const account = await repo.getById(id);
  if (!account) throw new Error('account not found');
  if (account.provider !== 'gmail') throw new Error('Only gmail supported for this test');

  let result: { accessToken: string; expiry: string; refreshToken: string; updated: boolean };
  try {
    result = await ensureValidGoogleAccessToken(
      account.tokens,
      cfg
    );
  } catch (e: any) {
    const errTxt = String(e?.message || e);
    const missing = /missing refresh token/i.test(errTxt) || /OAUTH_MISSING_REFRESH_TOKEN/i.test(errTxt);
    const invalidGrant = /invalid_grant/i.test(errTxt) || /expired or revoked/i.test(errTxt);
    const network = /(ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|network)/i.test(errTxt);
    const category = missing ? 'missing_refresh_token' : invalidGrant ? 'invalid_grant' : network ? 'network' : 'other';
    logger.error('Gmail test failed', { area: 'oauth', provider: 'google', op: 'gmail-test', accountId: id, email: account.email, category, error: errTxt });
    if (missing || invalidGrant) {
      return { ok: false, error: category, reauthRequired: true };
    }
    throw new Error(errTxt);
  }
  if (result.updated) {
    account.tokens.accessToken = result.accessToken;
    account.tokens.expiry = result.expiry;
    account.tokens.refreshToken = result.refreshToken;
    await repo.update(account);
    logger.info('Refreshed + persisted during gmail-test', { id });
  }

  // External dependency (googleapis) is already used in routes; reusing here would require passing client, so keep test lightweight here
  return {
    ok: true,
    tokenExpiry: account.tokens.expiry,
  };
}
