import { OAuthProviderConfig, computeExpiryISO, postForm } from './common';

const LOGIN_SCOPES = [
  'openid',
  'email',
  'profile',
];

export function buildGoogleLoginAuthUrl(cfg: OAuthProviderConfig, state: string): string {
  const base = 'https://accounts.google.com/o/oauth2/v2/auth';
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: LOGIN_SCOPES.join(' '),
    access_type: 'online',
    prompt: 'select_account',
    state,
  });
  return `${base}?${params.toString()}`;
}

/**
 * Exchange the Google authorization code for a short-lived access token for LOGIN only.
 * Unlike provider onboarding, this does NOT require a refresh token.
 */
export async function exchangeGoogleLoginCode(cfg: OAuthProviderConfig, code: string): Promise<{ accessToken: string; expiryISO: string; raw?: any }> {
  const tokenUrl = 'https://oauth2.googleapis.com/token';
  const json = await postForm<any>(tokenUrl, {
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
  });

  if (!json.access_token) {
    throw new Error('No access token in Google login response');
  }

  const accessToken = String(json.access_token);
  const expiryISO = typeof json.expires_in === 'number' ? computeExpiryISO(json.expires_in) : computeExpiryISO();
  return { accessToken, expiryISO, raw: json };
}
