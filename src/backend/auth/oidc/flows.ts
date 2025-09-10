import * as oidc from 'openid-client';
import { getGoogleLoginClient, buildLoginCookie, parseLoginCookie } from './issuer';
import { getGoogleLoginOAuthConfigOrPrimary, JWT_EXPIRES_IN_SEC, JWT_SECRET } from '../../config';
import { upsertUser } from '../../services/users';
import type { User } from '../../../shared/types';
import { signJwt } from '../../utils/jwt';

export async function initiateGoogleLogin(): Promise<{ url: string; loginCookie: string }> {
  const gen: any = (oidc as any).generators;
  const { state, nonce, code_verifier } = {
    state: gen.state(),
    nonce: gen.nonce(),
    code_verifier: gen.codeVerifier(),
  };
  const code_challenge = gen.codeChallenge(code_verifier);
  const client = await getGoogleLoginClient();
  const url = client.authorizationUrl({
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
    access_type: 'online',
    response_type: 'code',
  } as any);
  const loginCookie = buildLoginCookie({ state, nonce, code_verifier });
  return { url, loginCookie };
}

export async function handleGoogleLoginCallback(params: { code: string; state: string; cookieHeader?: string }): Promise<{ user: User; token: string }> {
  const { code, state, cookieHeader } = params;
  const stored = parseLoginCookie(cookieHeader);
  if (!stored || stored.state !== state) {
    throw new Error('Invalid or missing OIDC login state');
  }
  const client = await getGoogleLoginClient();
  const cfg = getGoogleLoginOAuthConfigOrPrimary();
  const tokenSet = await client.callback(cfg.redirectUri, { code, state }, { code_verifier: stored.code_verifier, state, nonce: stored.nonce });
  const info: any = await client.userinfo(tokenSet);
  const subOrId: string = info?.sub || info?.id || '';
  const email: string = info?.email || '';
  if (!subOrId || !email) throw new Error('OIDC profile missing id or email');
  const uid = `google:${subOrId}`;
  const nowIso = new Date().toISOString();
  const user: User = {
    id: uid,
    email,
    name: info?.name || info?.given_name || undefined,
    picture: info?.picture || undefined,
    createdAt: nowIso,
    lastLoginAt: nowIso,
  } as User;
  const saved = await upsertUser(user);
  const token = signJwt({ uid: saved.id, email: saved.email, name: saved.name, picture: saved.picture }, JWT_SECRET, { expiresInSec: JWT_EXPIRES_IN_SEC });
  return { user: saved, token };
}
