import https from 'https';
import logger from './logger';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, OUTLOOK_REDIRECT_URI, JWT_SECRET } from '../config';
import { signJwt, verifyJwt } from '../utils/jwt';
import { buildGoogleAuthUrl, exchangeGoogleCode, getGoogleUserInfo, ensureValidGoogleAccessToken } from '../oauth/google';
import { buildOutlookAuthUrl, exchangeOutlookCode, getOutlookUserInfo, ensureValidOutlookAccessToken, revokeOutlookToken } from '../oauth/outlook';
import { requireReq, repoGetAll, repoSetAll, requireUid } from '../utils/repo-access';
import type { ReqLike } from '../interfaces';
import type { Account } from '../../shared/types';
import { revokeGoogleToken } from '../oauth/google';

// Data access helpers
export async function listAccounts(req: ReqLike): Promise<Account[]> {
  const ureq = requireReq(req);
  return await repoGetAll<Account>(ureq, 'accounts');
}

async function persistAccounts(req: ReqLike, accounts: Account[]): Promise<void> {
  const ureq = requireReq(req);
  await repoSetAll<Account>(ureq, 'accounts', accounts);
}

export async function upsertAccount(req: ReqLike, next: Account): Promise<void> {
  const accounts = await listAccounts(req);
  const idx = accounts.findIndex(a => a.id === next.id);
  if (idx >= 0) accounts[idx] = next; else accounts.push(next);
  await persistAccounts(req, accounts);
  logger.info('Saved account', { id: next.id, uid: requireUid(req) });
}

export async function updateAccount(req: ReqLike, id: string, next: Account): Promise<void> {
  const accounts = await listAccounts(req);
  const idx = accounts.findIndex(a => a.id === id);
  if (idx === -1) throw new Error('Account not found');
  accounts[idx] = next;
  await persistAccounts(req, accounts);
  logger.info('Updated account', { id });
}

export async function deleteAccount(req: ReqLike, id: string): Promise<{ revokeStatus?: boolean; revokeError?: string }> {
  const accounts = await listAccounts(req);
  const idx = accounts.findIndex(a => a.id === id);
  if (idx === -1) throw new Error('Account not found');
  const account = accounts[idx];

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

  const filtered = accounts.filter(a => a.id !== id);
  await persistAccounts(req, filtered);
  logger.debug('Deleted account', { id, before: accounts.length, after: filtered.length });
  return { revokeStatus, revokeError };
}

// OAuth initiation
export function initiateGoogleAccountOAuth(rawState: string): string {
  const signedState = signJwt({ p: 'google.account', s: rawState, ts: Date.now() }, JWT_SECRET, { expiresInSec: 600 });
  return buildGoogleAuthUrl(
    { clientId: GOOGLE_CLIENT_ID!, clientSecret: GOOGLE_CLIENT_SECRET!, redirectUri: GOOGLE_REDIRECT_URI! },
    signedState
  );
}

export async function initiateOutlookAccountOAuth(rawState: string): Promise<string> {
  const signedState = signJwt({ p: 'outlook.account', s: rawState, ts: Date.now() }, JWT_SECRET, { expiresInSec: 600 });
  return buildOutlookAuthUrl(
    { clientId: OUTLOOK_CLIENT_ID!, clientSecret: OUTLOOK_CLIENT_SECRET!, redirectUri: OUTLOOK_REDIRECT_URI! },
    signedState
  );
}

// OAuth callbacks
export async function handleGoogleAccountCallback(code: string, stateToken: string, req: ReqLike): Promise<Account> {
  const payload = stateToken ? verifyJwt(stateToken, JWT_SECRET) : null;
  if (!payload || payload.p !== 'google.account') throw new Error('Invalid or expired state');
  const tokens = await exchangeGoogleCode({ clientId: GOOGLE_CLIENT_ID!, clientSecret: GOOGLE_CLIENT_SECRET!, redirectUri: GOOGLE_REDIRECT_URI! }, code);
  const me = await getGoogleUserInfo(tokens.accessToken);
  const email = me?.email || '';
  if (!email) throw new Error('Google profile missing email address');
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
  await upsertAccount(req, account);
  return account;
}

export async function handleOutlookAccountCallback(code: string, stateToken: string, req: ReqLike): Promise<Account> {
  const payload = stateToken ? verifyJwt(stateToken, JWT_SECRET) : null;
  if (!payload || payload.p !== 'outlook.account') throw new Error('Invalid or expired state');
  const tokens = await exchangeOutlookCode({ clientId: OUTLOOK_CLIENT_ID!, clientSecret: OUTLOOK_CLIENT_SECRET!, redirectUri: OUTLOOK_REDIRECT_URI! }, code);
  let email = '';
  if (tokens?.raw?.id_token) {
    try {
      const parts = String(tokens.raw.id_token).split('.');
      if (parts.length >= 2) {
        const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
        email = payload.preferred_username || payload.email || '';
      }
    } catch {}
  }
  if (!email) {
    const accessToken = tokens.accessToken || '';
    if (!accessToken) throw new Error('Outlook profile missing email address');
    const me = await getOutlookUserInfo(accessToken);
    email = (me && (me.mail || (Array.isArray(me.otherMails) && me.otherMails[0]) || me.userPrincipalName)) || '';
  }
  if (!email) throw new Error('Outlook profile missing email address');
  const account: Account = {
    id: email,
    provider: 'outlook',
    email,
    signature: '',
    tokens: {
      accessToken: tokens.accessToken || '',
      refreshToken: tokens.refreshToken || '',
      expiry: tokens.expiryISO,
    },
  } as any;
  await upsertAccount(req, account);
  return account;
}

// Refresh tokens and provider tests
export async function refreshAccount(req: ReqLike, id: string): Promise<any> {
  const accounts = await listAccounts(req);
  if (accounts.length === 0) throw new Error('no accounts found');
  const idx = accounts.findIndex(a => a.id === id);
  if (idx === -1) throw new Error('account not found');
  const account = accounts[idx];

  if (account.provider === 'gmail') {
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
        const rawState = `reauth:${id}`;
        const signedState = signJwt({ p: 'google', s: rawState, ts: Date.now() }, JWT_SECRET, { expiresInSec: 600 });
        const url = buildGoogleAuthUrl(
          { clientId: GOOGLE_CLIENT_ID!, clientSecret: GOOGLE_CLIENT_SECRET!, redirectUri: GOOGLE_REDIRECT_URI! },
          signedState
        );
        return { ok: false, error: category, authorizeUrl: url };
      }
      return { ok: false, error: errTxt };
    }
    if (result.updated) {
      account.tokens.accessToken = result.accessToken;
      account.tokens.expiry = result.expiry;
      account.tokens.refreshToken = result.refreshToken;
      accounts[idx] = account;
      await persistAccounts(req, accounts);
      logger.info('Refreshed + persisted Gmail access token', { id });
    }
    return { ok: true, updated: result.updated, tokens: account.tokens };
  } else if (account.provider === 'outlook') {
    if (!OUTLOOK_CLIENT_ID || !OUTLOOK_CLIENT_SECRET) {
      return { ok: false, error: 'Missing Outlook OAuth env vars (OUTLOOK_CLIENT_ID/OUTLOOK_CLIENT_SECRET)' };
    }
    const result = await ensureValidOutlookAccessToken(
      account,
      OUTLOOK_CLIENT_ID!,
      OUTLOOK_CLIENT_SECRET!,
      OUTLOOK_REDIRECT_URI!
    );
    if (result.error) {
      if (String(result.error).toLowerCase().includes('missing refresh token')) {
        const state = `reauth:${id}`;
        const url = buildOutlookAuthUrl(
          { clientId: OUTLOOK_CLIENT_ID!, clientSecret: OUTLOOK_CLIENT_SECRET!, redirectUri: OUTLOOK_REDIRECT_URI! },
          state
        );
        return { ok: false, error: 'missing_refresh_token', authorizeUrl: url };
      }
      logger.error('Outlook refresh failed', { id, error: result.error });
      return { ok: false, error: result.error };
    }
    if (result.updated) {
      account.tokens.accessToken = result.accessToken;
      account.tokens.expiry = result.expiry;
      account.tokens.refreshToken = result.refreshToken;
      accounts[idx] = account;
      await persistAccounts(req, accounts);
      logger.info('Refreshed + persisted Outlook access token', { id });
    }
    return { ok: true, updated: result.updated, tokens: account.tokens };
  } else {
    return { ok: false, error: 'Unknown provider' };
  }
}

export async function outlookTest(req: ReqLike, id: string): Promise<any> {
  if (!OUTLOOK_CLIENT_ID || !OUTLOOK_CLIENT_SECRET) {
    throw new Error('Missing Outlook OAuth env vars (OUTLOOK_CLIENT_ID/OUTLOOK_CLIENT_SECRET)');
  }
  const accounts = await listAccounts(req);
  if (accounts.length === 0) throw new Error('no accounts found');
  const idx = accounts.findIndex(a => a.id === id);
  if (idx === -1) throw new Error('account not found');
  const account = accounts[idx];
  if (account.provider !== 'outlook') throw new Error('Only outlook supported for this test');

  const result = await ensureValidOutlookAccessToken(
    account,
    OUTLOOK_CLIENT_ID!,
    OUTLOOK_CLIENT_SECRET!,
    OUTLOOK_REDIRECT_URI!
  );
  if (result.error) {
    if (String(result.error).toLowerCase().includes('missing refresh token')) {
      const rawState = `reauth:${id}`;
      const signedState = signJwt({ p: 'outlook', s: rawState, ts: Date.now() }, JWT_SECRET, { expiresInSec: 600 });
      const url = buildOutlookAuthUrl(
        { clientId: OUTLOOK_CLIENT_ID!, clientSecret: OUTLOOK_CLIENT_SECRET!, redirectUri: OUTLOOK_REDIRECT_URI! },
        signedState
      );
      return { ok: false, error: 'missing_refresh_token', authorizeUrl: url };
    }
    throw new Error(String(result.error));
  }
  if (result.updated) {
    account.tokens.accessToken = result.accessToken;
    account.tokens.expiry = result.expiry;
    account.tokens.refreshToken = result.refreshToken;
    accounts[idx] = account;
    await persistAccounts(req, accounts);
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
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new Error('Missing Google OAuth env vars (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REDIRECT_URI)');
  }
  const accounts = await listAccounts(req);
  const idx = accounts.findIndex(a => a.id === id);
  if (idx === -1) throw new Error('account not found');
  const account = accounts[idx];
  if (account.provider !== 'gmail') throw new Error('Only gmail supported for this test');

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
      const rawState = `reauth:${id}`;
      const signedState = signJwt({ p: 'google', s: rawState, ts: Date.now() }, JWT_SECRET, { expiresInSec: 600 });
      const url = buildGoogleAuthUrl(
        { clientId: GOOGLE_CLIENT_ID!, clientSecret: GOOGLE_CLIENT_SECRET!, redirectUri: GOOGLE_REDIRECT_URI! },
        signedState
      );
      return { ok: false, error: category, authorizeUrl: url };
    }
    throw new Error(errTxt);
  }
  if (result.updated) {
    account.tokens.accessToken = result.accessToken;
    account.tokens.expiry = result.expiry;
    account.tokens.refreshToken = result.refreshToken;
    accounts[idx] = account;
    await persistAccounts(req, accounts);
    logger.info('Refreshed + persisted during gmail-test', { id });
  }

  // External dependency (googleapis) is already used in routes; reusing here would require passing client, so keep test lightweight here
  return {
    ok: true,
    tokenExpiry: account.tokens.expiry,
  };
}
