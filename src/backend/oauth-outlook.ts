import { postForm, computeExpiryISO } from './oauth/common';
import { graphRequest } from './utils/graph';
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

export async function getOutlookAuthUrl(clientId: string, _clientSecret: string, redirectUri: string, state: string): Promise<string> {
  // Build raw v2.0 authorize URL for consistency with raw token exchange
  const authBase = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
  const scope = encodeURIComponent(SCOPES.join(' '));
  const url = `${authBase}?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${encodeURIComponent(state)}&prompt=consent`;
  return url;
}

export async function getOutlookTokens(clientId: string, clientSecret: string, redirectUri: string, code: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
}> {
  // Use raw v2.0 token endpoint to ensure refresh_token is returned and manageable by app
  const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
  const params = {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    scope: SCOPES.join(' '),
  } as Record<string, string>;
  const json = await postForm<any>(tokenUrl, params);
  // Normalize minimal fields expected by callers; leave full json to caller if needed
  return {
    access_token: String(json.access_token || ''),
    refresh_token: json.refresh_token ? String(json.refresh_token) : undefined,
    expires_in: typeof json.expires_in === 'number' ? json.expires_in : undefined,
    id_token: json.id_token ? String(json.id_token) : undefined,
  };
}

// Fetch Outlook/Microsoft Graph user profile
export async function getOutlookUserInfo(accessToken: string): Promise<any> {
  return await graphRequest('/v1.0/me', accessToken);
}

// Unify refresh check + refresh behavior; returns normalized shape
export async function ensureValidOutlookAccessToken(
  account: any,
  clientId: string,
  clientSecret: string
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
  if (!account?.tokens?.refreshToken) {
    return { accessToken: '', expiry: '', refreshToken: '', updated: false, error: 'Missing refresh token' };
  }

  try {
    const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
    const json = await postForm<any>(tokenUrl, {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: account.tokens.refreshToken,
    });

    const accessToken = (json.access_token as string | undefined) || '';
    const newRefreshToken = (json.refresh_token as string | undefined) || undefined; // may be omitted
    const expiresInSec = typeof json.expires_in === 'number' ? json.expires_in : undefined;
    if (!accessToken) {
      return { accessToken: '', expiry: '', refreshToken: account.tokens.refreshToken, updated: false, error: 'No access token returned from Microsoft' };
    }
    const expiryIso = computeExpiryISO(expiresInSec);

    return {
      accessToken,
      expiry: expiryIso,
      refreshToken: newRefreshToken || account.tokens.refreshToken,
      updated: true,
    };
  } catch (err: any) {
    return { accessToken: '', expiry: '', refreshToken: account.tokens?.refreshToken || '', updated: false, error: err?.message || String(err) };
  }
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
