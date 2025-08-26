import { OAuthProviderConfig, OAuthTokens, computeExpiryISO, postForm } from './common';
import { request as httpsRequest } from 'https';
import { google } from 'googleapis';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
  'email',
  'profile',
];

// Provide an OAuth2 client for Google APIs consumers (e.g., Gmail provider)
export function getGoogleOAuth2Client(clientId: string, clientSecret: string, redirectUri: string) {
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function buildGoogleAuthUrl(cfg: OAuthProviderConfig, state: string): string {
  const base = 'https://accounts.google.com/o/oauth2/v2/auth';
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state,
  });
  return `${base}?${params.toString()}`;
}

export async function exchangeGoogleCode(cfg: OAuthProviderConfig, code: string): Promise<OAuthTokens> {
  const tokenUrl = 'https://oauth2.googleapis.com/token';
  const json = await postForm<any>(tokenUrl, {
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
  });
  const accessToken = String(json.access_token || '');
  const refreshToken = json.refresh_token ? String(json.refresh_token) : undefined;
  const expiryISO = computeExpiryISO(typeof json.expires_in === 'number' ? json.expires_in : undefined);
  return { accessToken, refreshToken, expiryISO, raw: json };
}

export async function refreshGoogleToken(cfg: OAuthProviderConfig, refreshToken: string): Promise<OAuthTokens> {
  const tokenUrl = 'https://oauth2.googleapis.com/token';
  const json = await postForm<any>(tokenUrl, {
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const accessToken = String(json.access_token || '');
  const newRefresh = json.refresh_token ? String(json.refresh_token) : undefined;
  const expiryISO = computeExpiryISO(typeof json.expires_in === 'number' ? json.expires_in : undefined);
  return { accessToken, refreshToken: newRefresh || refreshToken, expiryISO, raw: json };
}

// Unify refresh check + refresh behavior; returns normalized shape
export async function ensureValidGoogleAccessToken(
  account: any,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<{ accessToken: string; expiry: string; refreshToken: string; updated: boolean; error?: string }>
{
  const now = Date.now();
  const expiryTime = account?.tokens?.expiry ? new Date(account.tokens.expiry).getTime() : 0;
  const needsRefresh = !account?.tokens?.accessToken || !expiryTime || expiryTime - now < 2 * 60 * 1000;

  if (!needsRefresh) {
    return {
      accessToken: account.tokens.accessToken,
      expiry: account.tokens.expiry,
      refreshToken: account.tokens.refreshToken,
      updated: false,
    };
  }

  const existingRefresh = account?.tokens?.refreshToken;
  if (!existingRefresh) return { accessToken: '', expiry: '', refreshToken: '', updated: false, error: 'Missing refresh token' };

  try {
    const tokens = await refreshGoogleToken(
      { clientId, clientSecret, redirectUri },
      existingRefresh
    );
    const accessToken = tokens.accessToken;
    if (!accessToken) {
      return { accessToken: '', expiry: '', refreshToken: existingRefresh, updated: false, error: 'No access token returned from Google' };
    }
    return {
      accessToken,
      expiry: tokens.expiryISO,
      refreshToken: tokens.refreshToken || existingRefresh,
      updated: true,
    };
  } catch (err: any) {
    return {
      accessToken: '',
      expiry: '',
      refreshToken: existingRefresh,
      updated: false,
      error: err?.message || String(err),
    };
  }
}

// Fetch Google OIDC userinfo using the access token
export async function getGoogleUserInfo(accessToken: string): Promise<any> {
  return await new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        method: 'GET',
        hostname: 'www.googleapis.com',
        path: '/oauth2/v2/userinfo',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            const json = text ? JSON.parse(text) : {};
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve(json);
            else reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage}: ${text}`));
          } catch (e) {
            reject(new Error(`Invalid JSON from Google: ${text}`));
          }
        });
      }
    );
    req.on('error', (err) => reject(err));
    req.end();
  });
}

// Revoke a Google token (access or refresh) per RFC7009
export async function revokeGoogleToken(token: string): Promise<boolean> {
  return await new Promise((resolve) => {
    const body = `token=${encodeURIComponent(token)}`;
    const req = httpsRequest(
      {
        method: 'POST',
        hostname: 'oauth2.googleapis.com',
        path: '/revoke',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        // Google returns 200 OK on success with empty body
        resolve(!!res.statusCode && res.statusCode >= 200 && res.statusCode < 300);
      }
    );
    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
}
