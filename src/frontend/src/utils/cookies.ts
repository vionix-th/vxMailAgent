export type SameSite = 'Lax' | 'Strict' | 'None';

export interface CookieOptions {
  path?: string;
  domain?: string;
  maxAge?: number; // seconds
  expires?: Date;
  sameSite?: SameSite;
  secure?: boolean;
}

const defaultOptions: Required<Pick<CookieOptions, 'path' | 'sameSite'>> = {
  path: '/',
  sameSite: 'Lax',
};

export function setCookie(name: string, value: string, options: CookieOptions = {}): void {
  if (typeof document === 'undefined') return;
  const parts: string[] = [];
  parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
  const opts: CookieOptions = { ...defaultOptions, ...options };
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAge))}`);
  if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
  if (opts.path) parts.push(`Path=${opts.path}`);
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  const isHttps = typeof location !== 'undefined' && location.protocol === 'https:';
  const secure = opts.secure ?? isHttps;
  if (secure) parts.push('Secure');
  document.cookie = parts.join('; ');
}

export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie ? document.cookie.split('; ') : [];
  for (const c of cookies) {
    const idx = c.indexOf('=');
    const k = idx > -1 ? c.substring(0, idx) : c;
    if (decodeURIComponent(k) === name) {
      const v = idx > -1 ? c.substring(idx + 1) : '';
      try { return decodeURIComponent(v); } catch { return v; }
    }
  }
  return null;
}

export function deleteCookie(name: string, options: CookieOptions = {}): void {
  setCookie(name, '', { ...options, maxAge: 0 });
}
