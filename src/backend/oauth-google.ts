import { google } from 'googleapis';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
  'email',
  'profile',
];

/** Create a Google OAuth2 client configured with the given credentials. */
export function getGoogleOAuth2Client(clientId: string, clientSecret: string, redirectUri: string) {
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/** Attempt to revoke a previously issued Google OAuth token. */
export async function revokeGoogleToken(token: string): Promise<boolean> {
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

/** Generate the Google OAuth authorization URL for user consent. */
export function getGoogleAuthUrl(clientId: string, clientSecret: string, redirectUri: string, state: string) {
  const oauth2Client = getGoogleOAuth2Client(clientId, clientSecret, redirectUri);
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state,
  });
}
