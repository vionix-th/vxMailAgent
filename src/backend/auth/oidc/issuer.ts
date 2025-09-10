import { Issuer, generators } from 'openid-client';
import { getGoogleLoginOAuthConfigOrPrimary, isProd } from '../../config';

// Cached clients/issuers to avoid repeated discovery
let googleIssuerPromise: Promise<any> | null = null;
let googleLoginClientPromise: Promise<any> | null = null;

export async function getGoogleIssuer(): Promise<any> {
  if (!googleIssuerPromise) {
    googleIssuerPromise = Issuer.discover('https://accounts.google.com');
  }
  return await googleIssuerPromise;
}

export async function getGoogleLoginClient(): Promise<any> {
  if (!googleLoginClientPromise) {
    const issuer = await getGoogleIssuer();
    const cfg = getGoogleLoginOAuthConfigOrPrimary();
    googleLoginClientPromise = Promise.resolve(new issuer.Client({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uris: [cfg.redirectUri],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
    }));
  }
  return await googleLoginClientPromise;
}

export function generateOidcLoginParams() {
  const state = generators.state();
  const nonce = generators.nonce();
  const code_verifier = generators.codeVerifier();
  return { state, nonce, code_verifier } as const;
}

export function buildLoginCookie(payload: { state: string; nonce: string; code_verifier: string }): string {
  // Minimal cookie builder to avoid importing cookie dep here. We can reuse 'cookie' module from utils if desired.
  // But routes will set this return string directly.
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const secure = isProd;
  const attrs = [
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${600}`,
    ...(secure ? ['Secure'] : []),
  ];
  return `vx.oidc.login=${data}; ${attrs.join('; ')}`;
}

export function parseLoginCookie(cookieHeader?: string): { state: string; nonce: string; code_verifier: string } | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(/;\s*/);
  const kv = Object.fromEntries(parts.map(p => {
    const i = p.indexOf('=');
    if (i === -1) return [p, ''];
    return [p.slice(0, i), p.slice(i + 1)];
  }));
  const raw = kv['vx.oidc.login'];
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const obj = JSON.parse(json);
    if (obj && typeof obj.state === 'string' && typeof obj.nonce === 'string' && typeof obj.code_verifier === 'string') return obj;
    return null;
  } catch {
    return null;
  }
}

export function clearLoginCookie(): string {
  const secure = isProd;
  const attrs = [
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    ...(secure ? ['Secure'] : []),
  ];
  return `vx.oidc.login=; ${attrs.join('; ')}`;
}
