import { postForm, computeExpiryISO } from './oauth/common';

export async function ensureValidOutlookAccessToken(
  account: any,
  clientId: string,
  clientSecret: string
): Promise<{ accessToken: string; expiry: string; refreshToken: string; updated: boolean; error?: string }>
{
  const now = Date.now();
  const expiryTime = account.tokens?.expiry ? new Date(account.tokens.expiry).getTime() : 0;
  const needsRefresh = !account.tokens?.accessToken || !expiryTime || (expiryTime - now < 2 * 60 * 1000);

  console.log('[OAUTH2][DEBUG] ensureValidOutlookAccessToken invoked', {
    accountId: account?.id,
    expiry: account?.tokens?.expiry,
    needsRefresh,
    hasRefreshToken: !!account?.tokens?.refreshToken,
  });

  if (!needsRefresh) {
    return {
      accessToken: account.tokens.accessToken,
      expiry: account.tokens.expiry,
      refreshToken: account.tokens.refreshToken,
      updated: false,
    };
  }
  if (!account.tokens?.refreshToken) {
    return { accessToken: '', expiry: '', refreshToken: '', updated: false, error: 'Missing refresh token' };
  }

  try {
    const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
    const json = await postForm<any>(tokenUrl, {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: account.tokens.refreshToken,
      // scope optional on refresh; omit to retain previously granted scopes
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
    console.error('[OAUTH2][ERROR] Outlook token refresh failed', {
      accountId: account?.id,
      error: err?.message || String(err),
      stack: err?.stack,
    });
    return { accessToken: '', expiry: '', refreshToken: account.tokens?.refreshToken || '', updated: false, error: err?.message || String(err) };
  }
}
