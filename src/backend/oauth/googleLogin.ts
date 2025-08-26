import { OAuthProviderConfig } from './common';

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
    include_granted_scopes: 'true',
    prompt: 'select_account',
    state,
  });
  return `${base}?${params.toString()}`;
}
