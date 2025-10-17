import https from 'https';
import logger from './logger';
import { ValidationError } from './error-handler';
import { enforceOAuthTokenInvariants, isReauthTokenValidationError } from './account-manager';
import { getGoogleOAuthConfig, getOutlookOAuthConfig } from '../config';
import { ensureValidGoogleAccessToken } from '../oauth/google';
import { ensureValidOutlookAccessToken, revokeOutlookToken } from '../oauth/outlook';
import { toUserScopedContext, requireUid, getAccountsRepo } from '../utils/repo-access';
import type { UserScopedContext, AppRequest } from '../interfaces';
import type { Account } from '../../shared/types';
import { isUuidV4 } from '../../shared/constructors';
import { revokeGoogleToken } from '../oauth/google';

// Data access helpers
export async function listAccounts(source: AppRequest | UserScopedContext): Promise<Account[]> {
  const ctx = toUserScopedContext(source);
  const repo = getAccountsRepo(ctx);
  const rows = await repo.list();
  return [...rows];
}

export async function upsertAccount(source: AppRequest | UserScopedContext, next: Account): Promise<void> {
  const ctx = toUserScopedContext(source);
  const repo = getAccountsRepo(ctx);
  if (!isUuidV4(next?.id)) {
    throw new ValidationError('Account id must be a UUID v4');
  }

  const canonical: Account = { ...next };
  const uid = requireUid(ctx);

  const existingById = await repo.getById(canonical.id);
  let operation: 'update' | 'insert' = 'insert';

  if (existingById) {
    operation = 'update';
  } else {
    const accounts = await repo.list();
    const target = accounts.find((account) => account.provider === canonical.provider && account.email.toLowerCase() === canonical.email.toLowerCase());
    if (target) {
      canonical.id = target.id;
      operation = 'update';
    }
  }

  if (operation === 'update') {
    await repo.update(canonical);
  } else {
    await repo.insert(canonical);
  }

  logger.info('Saved account', { id: canonical.id, uid, operation });
}

/**
 * Partial update for Account allowing safe fields only (no token/id/provider changes).
 * Currently supports updating `signature`.
 */
export async function updateAccountPartial(
  req: UserScopedContext,
  id: string,
  patch: { signature?: string }
): Promise<void> {
  const repo = getAccountsRepo(req);
  const current = await repo.getById(id);
  if (!current) throw new Error('Account not found');

  if (typeof patch.signature === 'string') {
    current.signature = patch.signature;
  }
  await repo.update(current);
  logger.info('Updated account (partial)', { id, fields: Object.keys(patch).filter(k => (patch as any)[k] !== undefined) });
}

export async function deleteAccount(source: AppRequest | UserScopedContext, id: string): Promise<{ revokeStatus?: boolean; revokeError?: string }> {
  const ctx = toUserScopedContext(source);
  const repo = getAccountsRepo(ctx);
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
export async function refreshAccount(source: AppRequest | UserScopedContext, id: string): Promise<any> {
  const ctx = toUserScopedContext(source);
  const repo = getAccountsRepo(ctx);
  const account = await repo.getById(id);
  if (!account) throw new Error('account not found');

  if (account.provider === 'gmail') {
    const cfg = getGoogleOAuthConfig();
    try {
      const persisted = enforceOAuthTokenInvariants('persisted', account.tokens);
      account.tokens = persisted;

      const result = await ensureValidGoogleAccessToken(
        account.tokens,
        cfg
      );
      const refreshed = enforceOAuthTokenInvariants('refreshed', result);
      account.tokens = refreshed;
      if (result.updated) {
        await repo.update(account);
        logger.info('Refreshed + persisted Gmail access token', { id });
      }
      return { ok: true, updated: result.updated, tokens: account.tokens, provider: account.provider };
    } catch (e: any) {
      const errTxt = String(e?.message || e);
      const errCode = typeof e?.code === 'string' ? e.code : undefined;
      const invalidGrant = /invalid_grant/i.test(errTxt) || /expired or revoked/i.test(errTxt);
      const network = /(ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|network)/i.test(errTxt);
      const requiresReauth = invalidGrant || isReauthTokenValidationError(e);
      const category = invalidGrant
        ? 'invalid_grant'
        : requiresReauth ? 'missing_refresh_token'
        : network ? 'network'
        : 'other';

      logger.error('Google refresh failed', {
        area: 'oauth',
        provider: 'google',
        op: 'refresh',
        accountId: id,
        email: account.email,
        category,
        error: errTxt,
        code: errCode
      });

      if (requiresReauth) {
        return { ok: false, error: category, reauthRequired: true, provider: account.provider };
      }
      if (network) {
        return { ok: false, error: category, provider: account.provider };
      }
      return { ok: false, error: errTxt, provider: account.provider };
    }
  } else if (account.provider === 'outlook') {
    let cfg;
    try {
      cfg = getOutlookOAuthConfig();
    } catch (e: any) {
      const errTxt = String(e?.message || e);
      logger.error('Outlook refresh failed to load config', { id, error: errTxt, code: e?.code });
      return { ok: false, error: errTxt, provider: account.provider };
    }
    try {
      const persisted = enforceOAuthTokenInvariants('persisted', account.tokens);
      account.tokens = persisted;
      const result = await ensureValidOutlookAccessToken(
        account.tokens,
        cfg
      );
      const refreshed = enforceOAuthTokenInvariants('refreshed', result);
      account.tokens = refreshed;
      if (result.updated) {
        await repo.update(account);
        logger.info('Refreshed + persisted Outlook access token', { id });
      }
      return { ok: true, updated: result.updated, tokens: account.tokens, provider: account.provider };
    } catch (e: any) {
      const errTxt = String(e?.message || e);
      const errCode = typeof e?.code === 'string' ? e.code : undefined;
      const invalidGrant = /invalid_grant/i.test(errTxt) || /expired or revoked/i.test(errTxt);
      const requiresReauth = invalidGrant || isReauthTokenValidationError(e);
      const network = /(ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|network)/i.test(errTxt);
      const category = invalidGrant
        ? 'invalid_grant'
        : requiresReauth ? 'missing_refresh_token'
        : network ? 'network'
        : 'other';

      logger.error('Outlook refresh failed', {
        area: 'oauth',
        provider: 'outlook',
        op: 'refresh',
        accountId: id,
        email: account.email,
        category,
        error: errTxt,
        code: errCode
      });

      if (requiresReauth) {
        return { ok: false, error: category, reauthRequired: true, provider: account.provider };
      }
      if (network) {
        return { ok: false, error: category, provider: account.provider };
      }
      return { ok: false, error: errTxt, provider: account.provider };
    }
  } else {
    return { ok: false, error: 'Unknown provider' };
  }
}

export async function outlookTest(source: AppRequest | UserScopedContext, id: string): Promise<any> {
  const cfg = getOutlookOAuthConfig();
  const ctx = toUserScopedContext(source);
  const repo = getAccountsRepo(ctx);
  const account = await repo.getById(id);
  if (!account) throw new Error('account not found');
  if (account.provider !== 'outlook') throw new Error('Only outlook supported for this test');

  let result: { accessToken: string; expiry: string; refreshToken: string; updated: boolean };
  try {
    const persisted = enforceOAuthTokenInvariants('persisted', account.tokens);
    account.tokens = persisted;

    result = await ensureValidOutlookAccessToken(
      account.tokens,
      cfg
    );

    const refreshed = enforceOAuthTokenInvariants('refreshed', result);
    account.tokens = refreshed;

    if (result.updated) {
      await repo.update(account);
      logger.info('Refreshed + persisted during outlook-test', { id });
    }
  } catch (e: any) {
    const errTxt = String(e?.message || e);
    const invalidGrant = /invalid_grant/i.test(errTxt) || /expired or revoked/i.test(errTxt);
    const requiresReauth = invalidGrant || isReauthTokenValidationError(e);
    const category = invalidGrant ? 'invalid_grant' : 'missing_refresh_token';
    if (requiresReauth) {
      return { ok: false, error: category, reauthRequired: true, provider: account.provider };
    }
    throw new Error(errTxt);
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

export async function gmailTest(source: AppRequest | UserScopedContext, id: string): Promise<any> {
  const cfg = getGoogleOAuthConfig();
  const ctx = toUserScopedContext(source);
  const repo = getAccountsRepo(ctx);
  const account = await repo.getById(id);
  if (!account) throw new Error('account not found');
  if (account.provider !== 'gmail') throw new Error('Only gmail supported for this test');

  try {
    const persisted = enforceOAuthTokenInvariants('persisted', account.tokens);
    account.tokens = persisted;

    const result = await ensureValidGoogleAccessToken(
      account.tokens,
      cfg
    );

    const refreshed = enforceOAuthTokenInvariants('refreshed', result);
    account.tokens = refreshed;

    if (result.updated) {
      await repo.update(account);
      logger.info('Refreshed + persisted during gmail-test', { id });
    }
  } catch (e: any) {
    const errTxt = String(e?.message || e);
    const errCode = typeof e?.code === 'string' ? e.code : undefined;
    const invalidGrant = /invalid_grant/i.test(errTxt) || /expired or revoked/i.test(errTxt);
    const network = /(ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|network)/i.test(errTxt);
    const requiresReauth = invalidGrant || isReauthTokenValidationError(e);
    const category = invalidGrant
      ? 'invalid_grant'
      : requiresReauth ? 'missing_refresh_token'
      : network ? 'network'
      : 'other';

    logger.error('Gmail test failed', {
      area: 'oauth',
      provider: 'google',
      op: 'gmail-test',
      accountId: id,
      email: account.email,
      category,
      error: errTxt,
      code: errCode
    });

    if (requiresReauth) {
      return { ok: false, error: category, reauthRequired: true, provider: account.provider };
    }
    if (network) {
      return { ok: false, error: category };
    }
    throw new Error(errTxt);
  }

  // External dependency (googleapis) is already used in routes; reusing here would require passing client, so keep test lightweight here
  return {
    ok: true,
    tokenExpiry: account.tokens.expiry,
  };
}
