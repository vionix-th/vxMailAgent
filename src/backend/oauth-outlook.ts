import { postForm } from './oauth/common';

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

/** Build the Outlook OAuth authorization URL. */
export async function getOutlookAuthUrl(clientId: string, _clientSecret: string, redirectUri: string, state: string): Promise<string> {
  const authBase = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
  const scope = encodeURIComponent(SCOPES.join(' '));
  const url = `${authBase}?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${encodeURIComponent(state)}&prompt=consent`;
  return url;
}

/** Exchange an authorization code for Outlook OAuth tokens. */
export async function getOutlookTokens(clientId: string, clientSecret: string, redirectUri: string, code: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
}> {
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
  return {
    access_token: String(json.access_token || ''),
    refresh_token: json.refresh_token ? String(json.refresh_token) : undefined,
    expires_in: typeof json.expires_in === 'number' ? json.expires_in : undefined,
    id_token: json.id_token ? String(json.id_token) : undefined,
  };
}
