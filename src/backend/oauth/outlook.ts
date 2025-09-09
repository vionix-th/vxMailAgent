import { OAuthProviderConfig, OAuthTokens, computeExpiryISO, postForm } from './common';
import { OAuthError } from '../services/error-handler';
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
  
  if (!json.access_token) {
    throw new OAuthError('No access token in Outlook response', 'OAUTH_NO_ACCESS_TOKEN', 502);
  }
  
  const accessToken = String(json.access_token);
  const refreshToken = json.refresh_token ? String(json.refresh_token) : undefined;
  const expiryISO = typeof json.expires_in === 'number' ? computeExpiryISO(json.expires_in) : computeExpiryISO();
  
  if (!refreshToken) {
    throw new OAuthError('No refresh token in Outlook response', 'OAUTH_NO_REFRESH_TOKEN', 502);
  }
  
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
  
  if (!json.access_token) {
    throw new OAuthError('No access token in Outlook refresh response', 'OAUTH_NO_ACCESS_TOKEN', 502);
  }
  
  const accessToken = String(json.access_token);
  const newRefreshToken = json.refresh_token ? String(json.refresh_token) : undefined;
  const expiryISO = computeExpiryISO(typeof json.expires_in === 'number' ? json.expires_in : undefined);
  
  return { accessToken, refreshToken: newRefreshToken || refreshToken, expiryISO, raw: json };
}

/** Check if Outlook access token needs refresh based on expiry time. */
export function needsOutlookTokenRefresh(tokens: { accessToken?: string; expiry?: string }): boolean {
  if (!tokens.accessToken) return true;
  if (!tokens.expiry) return true;
  
  const expiryTime = new Date(tokens.expiry).getTime();
  const now = Date.now();
  return expiryTime - now < 2 * 60 * 1000;
}

/** Validate and refresh Outlook access token if needed. */
export async function ensureValidOutlookAccessToken(
  tokens: { accessToken: string; expiry: string; refreshToken: string },
  config: OAuthProviderConfig
): Promise<{ accessToken: string; expiry: string; refreshToken: string; updated: boolean }> {
  if (!needsOutlookTokenRefresh(tokens)) {
    return { ...tokens, updated: false };
  }

  if (!tokens.refreshToken) {
    throw new OAuthError('Missing refresh token', 'OAUTH_MISSING_REFRESH_TOKEN', 401);
  }

  const refreshedTokens = await refreshOutlookToken(config, tokens.refreshToken);
  if (!refreshedTokens.accessToken) {
    throw new OAuthError('No access token returned from Microsoft', 'OAUTH_NO_ACCESS_TOKEN', 502);
  }

  return {
    accessToken: refreshedTokens.accessToken,
    expiry: refreshedTokens.expiryISO,
    refreshToken: refreshedTokens.refreshToken || tokens.refreshToken,
    updated: true,
  };
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
