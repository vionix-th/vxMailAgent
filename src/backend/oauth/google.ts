import { OAuthProviderConfig, OAuthTokens, computeExpiryISO, postForm } from './common';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
  'email',
  'profile',
];

/** Build the Google OAuth authorization URL. */
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

/** Exchange an authorization code for Google OAuth tokens. */
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

/** Refresh an existing Google OAuth token. */
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
