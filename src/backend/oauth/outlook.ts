import { OAuthProviderConfig, OAuthTokens, computeExpiryISO, postForm } from './common';
import { graphRequest } from '../utils/graph';
import { request as httpsRequest } from 'https';

const SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'User.Read',
  'Mail.Read',
  'Mail.Send',
  'Calendars.ReadWrite',
  'Tasks.ReadWrite',
];

export function buildOutlookAuthUrl(cfg: OAuthProviderConfig, state: string): string {
  const authBase = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
  const scope = encodeURIComponent(SCOPES.join(' '));
  const url = `${authBase}?client_id=${encodeURIComponent(cfg.clientId)}&response_type=code&redirect_uri=${encodeURIComponent(cfg.redirectUri)}&scope=${scope}&state=${encodeURIComponent(state)}&prompt=consent`;
  return url;
}

export async function exchangeOutlookCode(cfg: OAuthProviderConfig, code: string): Promise<OAuthTokens> {
  const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
  const json = await postForm<any>(tokenUrl, {
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
    scope: SCOPES.join(' '),
  });
  const accessToken = String(json.access_token || '');
  const refreshToken = json.refresh_token ? String(json.refresh_token) : undefined;
  const expiryISO = computeExpiryISO(typeof json.expires_in === 'number' ? json.expires_in : undefined);
  return { accessToken, refreshToken, expiryISO, raw: json };
}

export async function refreshOutlookToken(cfg: OAuthProviderConfig, refreshToken: string): Promise<OAuthTokens> {
  const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
  const json = await postForm<any>(tokenUrl, {
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const accessToken = String(json.access_token || '');
  const newRefreshToken = json.refresh_token ? String(json.refresh_token) : undefined;
  const expiryISO = computeExpiryISO(typeof json.expires_in === 'number' ? json.expires_in : undefined);
  return { accessToken, refreshToken: newRefreshToken || refreshToken, expiryISO, raw: json };
}

// Unify refresh check + refresh behavior; returns normalized shape
export async function ensureValidOutlookAccessToken(
  account: any,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<{ accessToken: string; expiry: string; refreshToken: string; updated: boolean; error?: string }>
{
  const now = Date.now();
  const expiryTime = account?.tokens?.expiry ? new Date(account.tokens.expiry).getTime() : 0;
  const needsRefresh = !account?.tokens?.accessToken || !expiryTime || (expiryTime - now < 2 * 60 * 1000);

  if (!needsRefresh) {
    return {
      accessToken: account.tokens.accessToken,
      expiry: account.tokens.expiry,
      refreshToken: account.tokens.refreshToken,
      updated: false,
    };
  }
  const existingRefresh = account?.tokens?.refreshToken;
  if (!existingRefresh) {
    return { accessToken: '', expiry: '', refreshToken: '', updated: false, error: 'Missing refresh token' };
  }

  try {
    const tokens = await refreshOutlookToken({ clientId, clientSecret, redirectUri }, existingRefresh);
    const accessToken = tokens.accessToken;
    if (!accessToken) {
      return { accessToken: '', expiry: '', refreshToken: existingRefresh, updated: false, error: 'No access token returned from Microsoft' };
    }
    return {
      accessToken,
      expiry: tokens.expiryISO,
      refreshToken: tokens.refreshToken || existingRefresh,
      updated: true,
    };
  } catch (err: any) {
    return { accessToken: '', expiry: '', refreshToken: existingRefresh, updated: false, error: err?.message || String(err) };
  }
}

// Fetch Outlook/Microsoft Graph user profile
export async function getOutlookUserInfo(accessToken: string): Promise<any> {
  return await graphRequest('/v1.0/me', accessToken);
}

export async function revokeOutlookToken(token: string): Promise<boolean> {
  // Best-effort RFC7009 token revocation. Some tenants/providers may not support revoke; return false on failure.
  return await new Promise((resolve) => {
    const body = `token=${encodeURIComponent(token)}`;
    const req = httpsRequest(
      {
        method: 'POST',
        hostname: 'login.microsoftonline.com',
        path: '/common/oauth2/v2.0/revoke',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        resolve(!!res.statusCode && res.statusCode >= 200 && res.statusCode < 300);
      }
    );
    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
}
