import { refreshGoogleToken } from './oauth/google';

export async function ensureValidGoogleAccessToken(
  account: any,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<{ accessToken: string; expiry: string; refreshToken: string; updated: boolean; error?: string }> {
  const now = Date.now();
  const expiryTime = account.tokens.expiry ? new Date(account.tokens.expiry).getTime() : 0;
  const needsRefresh = !account.tokens.accessToken || !expiryTime || expiryTime - now < 2 * 60 * 1000;

  console.log('[OAUTH2][DEBUG] ensureValidGoogleAccessToken invoked', {
    accountId: account.id,
    clientId,
    redirectUri,
    expiry: account.tokens.expiry,
    needsRefresh,
    hasRefreshToken: !!account.tokens.refreshToken,
  });

  if (!needsRefresh) {
    return {
      accessToken: account.tokens.accessToken,
      expiry: account.tokens.expiry,
      refreshToken: account.tokens.refreshToken,
      updated: false,
    };
  }

  const existingRefresh = account.tokens.refreshToken;
  if (!existingRefresh) {
    return { accessToken: '', expiry: '', refreshToken: '', updated: false, error: 'Missing refresh token' };
  }

  try {
    const tokens = await refreshGoogleToken(
      { clientId, clientSecret, redirectUri },
      existingRefresh
    );
    const accessToken = tokens.accessToken;
    if (!accessToken) {
      return {
        accessToken: '',
        expiry: '',
        refreshToken: existingRefresh,
        updated: false,
        error: 'No access token returned from Google',
      };
    }

    return {
      accessToken,
      expiry: tokens.expiryISO,
      refreshToken: tokens.refreshToken || existingRefresh,
      updated: true,
    };
  } catch (err: any) {
    console.error('[OAUTH2][ERROR] Google token refresh failed', {
      accountId: account.id,
      clientId,
      redirectUri,
      refreshToken: existingRefresh?.slice(0, 6) + '...' || '(none)',
      error: err?.message || String(err),
      stack: err?.stack,
    });
    return {
      accessToken: '',
      expiry: '',
      refreshToken: existingRefresh,
      updated: false,
      error: err?.message || String(err),
    };
  }
}

