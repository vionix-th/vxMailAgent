import type { OAuthProviderConfig, OAuthTokens } from './common';
import { OAuthError } from '../services/error-handler';
import { request as httpsRequest } from 'https';
import * as oidc from 'openid-client';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
  'email',
  'profile',
];

// openid-client Issuer/Client cache
let googleIssuerPromise: Promise<any> | null = null;
let googleClientPromise: Promise<any> | null = null;

async function getIssuer() {
  if (!googleIssuerPromise) {
    const Issuer: any = (oidc as any).Issuer;
    googleIssuerPromise = Issuer.discover('https://accounts.google.com');
  }
  return await googleIssuerPromise;
}

async function getClient(cfg: OAuthProviderConfig) {
  if (!googleClientPromise) {
    const issuer = await getIssuer();
    googleClientPromise = Promise.resolve(new issuer.Client({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uris: [cfg.redirectUri],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
    }));
  }
  return await googleClientPromise;
}

export function buildGoogleAuthUrl(cfg: OAuthProviderConfig, state: string): string {
  // Build an authorization URL using openid-client
  // Note: openid-client client instance depends on cfg; but URL generation does not require network.
  const params: Record<string, string> = {
    redirect_uri: cfg.redirectUri,
    scope: SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    response_type: 'code',
    state,
  } as const;
  // Construct manually to avoid awaiting discovery on hot path
  const base = 'https://accounts.google.com/o/oauth2/v2/auth';
  const usp = new URLSearchParams(params);
  return `${base}?${usp.toString()}`;
}

export async function exchangeGoogleCode(cfg: OAuthProviderConfig, code: string): Promise<OAuthTokens> {
  const client = await getClient(cfg);
  const tokenSet = await client.callback(cfg.redirectUri, { code }, {});
  const accessToken = String(tokenSet.access_token || '');
  const refreshToken = tokenSet.refresh_token ? String(tokenSet.refresh_token) : undefined;
  const expiresIn = (tokenSet.expires_in && typeof tokenSet.expires_in === 'number') ? tokenSet.expires_in : undefined;
  const expiryISO = new Date(Date.now() + (expiresIn ? expiresIn : 55 * 60) * 1000).toISOString();
  if (!accessToken) throw new OAuthError('No access token in Google response', 'OAUTH_NO_ACCESS_TOKEN', 502);
  if (!refreshToken) throw new OAuthError('No refresh token in Google response', 'OAUTH_NO_REFRESH_TOKEN', 502);
  return { accessToken, refreshToken, expiryISO, raw: tokenSet }; 
}

export async function refreshGoogleToken(cfg: OAuthProviderConfig, refreshToken: string): Promise<OAuthTokens> {
  const client = await getClient(cfg);
  const tokenSet = await client.refresh(refreshToken);
  const accessToken = String(tokenSet.access_token || '');
  if (!accessToken) throw new OAuthError('No access token in Google refresh response', 'OAUTH_NO_ACCESS_TOKEN', 502);
  const newRefresh = tokenSet.refresh_token ? String(tokenSet.refresh_token) : undefined;
  const expiresIn = (tokenSet.expires_in && typeof tokenSet.expires_in === 'number') ? tokenSet.expires_in : undefined;
  const expiryISO = new Date(Date.now() + (expiresIn ? expiresIn : 55 * 60) * 1000).toISOString();
  return { accessToken, refreshToken: newRefresh || refreshToken, expiryISO, raw: tokenSet };
}

/** Check if access token needs refresh based on expiry time. */
export function needsTokenRefresh(tokens: { accessToken?: string; expiry?: string }): boolean {
  if (!tokens.accessToken) return true;
  if (!tokens.expiry) return true;
  
  const expiryTime = new Date(tokens.expiry).getTime();
  const now = Date.now();
  return expiryTime - now < 2 * 60 * 1000;
}

/** Validate and refresh Google access token if needed. */
export async function ensureValidGoogleAccessToken(
  tokens: { accessToken: string; expiry: string; refreshToken: string },
  config: OAuthProviderConfig
): Promise<{ accessToken: string; expiry: string; refreshToken: string; updated: boolean }> {
  if (!needsTokenRefresh(tokens)) {
    return { ...tokens, updated: false };
  }

  if (!tokens.refreshToken) {
    throw new OAuthError('Missing refresh token', 'OAUTH_MISSING_REFRESH_TOKEN', 401);
  }

  const refreshedTokens = await refreshGoogleToken(config, tokens.refreshToken);
  if (!refreshedTokens.accessToken) {
    throw new OAuthError('No access token returned from Google', 'OAUTH_NO_ACCESS_TOKEN', 502);
  }

  return {
    accessToken: refreshedTokens.accessToken,
    expiry: refreshedTokens.expiryISO,
    refreshToken: refreshedTokens.refreshToken || tokens.refreshToken,
    updated: true,
  };
}

// Fetch Google OIDC userinfo using the access token
export async function getGoogleUserInfo(accessToken: string): Promise<any> {
  // Use openid-client userinfo endpoint for profile
  const issuer = await getIssuer();
  // Build a transient client without secrets for userinfo
  const client = new issuer.Client({ client_id: 'anonymous' } as any);
  return await client.userinfo(accessToken);
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
