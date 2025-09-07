import { getGoogleLoginOAuthConfigOrPrimary, JWT_EXPIRES_IN_SEC, JWT_SECRET } from '../config';
import { buildGoogleLoginAuthUrl } from '../oauth/googleLogin';
import { exchangeGoogleCode, getGoogleUserInfo } from '../oauth/google';
import { signJwt, verifyJwt } from '../utils/jwt';
import { upsertUser } from './users';
import type { User } from '../../shared/types';

/** Build the Google login initiation URL with signed state. */
export function getGoogleLoginUrl(): string {
  const googleCfg = getGoogleLoginOAuthConfigOrPrimary();
  const rawState = JSON.stringify({ mode: 'login', provider: 'google' });
  const signedState = signJwt({ p: 'google.login', s: rawState, ts: Date.now() }, JWT_SECRET, { expiresInSec: 600 });
  return buildGoogleLoginAuthUrl(googleCfg, signedState);
}

/** Handle Google login callback; returns persisted User and signed session token. */
export async function handleGoogleLoginCallback(code: string, state: string): Promise<{ user: User; token: string }> {
  const googleCfg = getGoogleLoginOAuthConfigOrPrimary();
  const payload = state ? verifyJwt(state, JWT_SECRET) : null;
  if (!payload || payload.p !== 'google.login') throw new Error('Invalid or expired state');
  const tokens = await exchangeGoogleCode(googleCfg, code);
  const me: any = await getGoogleUserInfo(tokens.accessToken);
  const subOrId: string = me?.id || me?.sub || '';
  const email: string = me?.email || '';
  if (!subOrId || !email) throw new Error('Google profile missing id or email');
  const uid = `google:${subOrId}`;
  const nowIso = new Date().toISOString();
  const user: User = {
    id: uid,
    email,
    name: me?.name || me?.given_name || undefined,
    picture: me?.picture || undefined,
    createdAt: nowIso,
    lastLoginAt: nowIso,
  };
  const saved = await upsertUser(user);
  const token = signJwt({ uid: saved.id, email: saved.email, name: saved.name, picture: saved.picture }, JWT_SECRET, { expiresInSec: JWT_EXPIRES_IN_SEC });
  return { user: saved, token };
}

/** Verify a session token and return minimal user projection. */
export function getUserFromToken(token: string): { id: string; email?: string; name?: string; picture?: string } | null {
  try {
    const payload = verifyJwt(token, JWT_SECRET);
    if (!payload || typeof payload.uid !== 'string') return null;
    return { id: payload.uid, email: payload.email, name: payload.name, picture: payload.picture };
  } catch {
    return null;
  }
}
