import * as oidc from 'openid-client';
import { getGoogleLoginClient, getGoogleAccountClient, buildLoginCookie, parseLoginCookie } from './issuer';
import { getGoogleLoginOAuthConfigOrPrimary, getGoogleOAuthConfig, JWT_EXPIRES_IN_SEC, JWT_SECRET } from '../../config';
import { upsertUser } from '../../services/users';
import { upsertAccount } from '../../services/accounts';
import type { User, Account } from '../../../shared/types';
import { signJwt } from '../../utils/jwt';
import type { ReqLike } from '../../interfaces';
import { AuthenticationError, ValidationError } from '../../services/error-handler';
import logger from '../../services/logger';

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
    throw new AuthenticationError('Invalid or missing OIDC login state');
  }
  const client = await getGoogleLoginClient();
  const cfg = getGoogleLoginOAuthConfigOrPrimary();
  const tokenSet = await client.callback(cfg.redirectUri, { code, state }, { code_verifier: stored.code_verifier, state, nonce: stored.nonce });
  const info: any = await client.userinfo(tokenSet);
  const subOrId: string = (info?.sub ?? info?.id ?? '') as string;
  const email: string = (info?.email ?? '') as string;
  if (!subOrId || !email) throw new ValidationError('OIDC profile missing id or email');
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

export async function initiateGoogleAccountOAuth(rawState: string): Promise<{ url: string; loginCookie: string }> {
  const gen: any = (oidc as any).generators;
  const { state, nonce, code_verifier } = {
    state: gen.state(),
    nonce: gen.nonce(),
    code_verifier: gen.codeVerifier(),
  };
  const code_challenge = gen.codeChallenge(code_verifier);
  const client = await getGoogleAccountClient();
  const url = client.authorizationUrl({
    scope: 'openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks',
    state,
    nonce,
    code_challenge,
    code_challenge_method: 'S256',
    prompt: 'consent',
    access_type: 'offline',
    response_type: 'code',
  } as any);
  const loginCookie = buildLoginCookie({ state, nonce, code_verifier, rawState });
  return { url, loginCookie };
}

export async function handleGoogleAccountCallback(code: string, stateToken: string, cookieHeader: string | undefined, req: ReqLike): Promise<Account> {
  const stored = parseLoginCookie(cookieHeader);
  if (!stored || stored.state !== stateToken) {
    throw new AuthenticationError('Invalid or missing OIDC account state');
  }
  
  const client = await getGoogleAccountClient();
  const cfg = getGoogleOAuthConfig();
  const tokenSet = await client.callback(cfg.redirectUri, { code, state: stateToken }, { 
    code_verifier: stored.code_verifier, 
    state: stateToken, 
    nonce: stored.nonce 
  });
  
  // Enforce token completeness: both access and refresh tokens are mandatory
  const accessToken = String(tokenSet.access_token ?? '');
  const refreshToken = String(tokenSet.refresh_token ?? '');
  if (!accessToken) {
    throw new ValidationError('No access token in Google response');
  }
  if (!refreshToken) {
    // Require offline access; callers should initiate with prompt=consent + access_type=offline
    throw new ValidationError('No refresh token in Google response');
  }

  const info: any = await client.userinfo(tokenSet);
  const email: string = (info?.email ?? '') as string;
  if (!email) throw new ValidationError('Google profile missing email address');
  
  const account: Account = {
    id: email,
    provider: 'gmail',
    email,
    signature: '',
    tokens: {
      accessToken,
      refreshToken,
      expiry: new Date(Date.now() + ((tokenSet.expires_in as number || 3600) * 1000)).toISOString(),
    },
  } as Account;
  
  logger.info('About to upsert Google account', { email, hasAccessToken: !!tokenSet.access_token, hasRefreshToken: !!tokenSet.refresh_token });
  await upsertAccount(req, account);
  logger.info('Google account upserted successfully', { email });
  return account;
}
