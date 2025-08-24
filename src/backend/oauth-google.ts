import { google } from 'googleapis';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
  'email',
  'profile',
];

export function getGoogleOAuth2Client(clientId: string, clientSecret: string, redirectUri: string) {
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export async function revokeGoogleToken(token: string): Promise<boolean> {
  // Google's token revocation endpoint: https://oauth2.googleapis.com/revoke
  // Accepts either access_token or refresh_token
  try {
    const fetch = require('node-fetch');
    const res = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${encodeURIComponent(token)}`,
    });
    return res.ok;
  } catch (e) {
    console.error('[OAUTH2] Error revoking Google token:', e);
    return false;
  }
}

export function getGoogleAuthUrl(clientId: string, clientSecret: string, redirectUri: string, state: string) {
  const oauth2Client = getGoogleOAuth2Client(clientId, clientSecret, redirectUri);
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state,
  });
}
