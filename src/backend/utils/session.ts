import cookie from 'cookie';

export const SESSION_COOKIE_NAME = 'vx.session';

export function serializeSessionCookie(token: string, opts: { maxAgeSec: number; secure: boolean }): string {
  return cookie.serialize(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: opts.secure,
    maxAge: opts.maxAgeSec,
    path: '/',
  });
}

export function clearSessionCookie(secure: boolean): string {
  return cookie.serialize(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: 0,
    path: '/',
  });
}

export function extractTokenFromHeaders(headers: Record<string, unknown>): string | undefined {
  const cookieHeader = typeof headers['cookie'] === 'string' ? headers['cookie'] : undefined;
  if (cookieHeader) {
    const parsed = cookie.parse(cookieHeader);
    if (parsed[SESSION_COOKIE_NAME]) return parsed[SESSION_COOKIE_NAME];
  }
  const authHeader = typeof headers['authorization'] === 'string' ? headers['authorization'] : undefined;
  if (authHeader && /^bearer /i.test(authHeader)) return authHeader.slice(7);
  return undefined;
}
