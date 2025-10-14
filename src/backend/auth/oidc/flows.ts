import * as oidc from 'openid-client';
import { getGoogleLoginClient, getGoogleAccountClient, buildLoginCookie, parseLoginCookie } from './issuer';
import { getGoogleLoginOAuthConfigOrPrimary, getGoogleOAuthConfig, JWT_EXPIRES_IN_SEC, JWT_SECRET } from '../../config';
import { upsertUser } from '../../services/users';
import { upsertAccount } from '../../services/accounts';
import type { User, Account } from '../../../shared/types';
import { createAccount } from '../../../shared/constructors';
import { signJwt } from '../../utils/jwt';
import { ensureContext } from '../../utils/repo-access';
import type { ContextInput } from '../../utils/repo-access';
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
  const subOrId = (info?.sub ?? info?.id) as string | undefined;
  const email = info?.email as string | undefined;
  const name = typeof info?.name === 'string' && info.name ? info.name : (typeof info?.given_name === 'string' && info.given_name ? info.given_name : undefined);
  const picture = typeof info?.picture === 'string' && info.picture ? info.picture : undefined;
  if (!subOrId || !email) throw new ValidationError('OIDC profile missing id or email');
  const uid = `google:${subOrId}`;
  const nowIso = new Date().toISOString();
  const user: User = {
    id: uid,
    email,
    name,
    picture,
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

export async function handleGoogleAccountCallback(code: string, stateToken: string, cookieHeader: string | undefined, req: ContextInput): Promise<Account> {
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
  const accessToken = tokenSet.access_token as string | undefined;
  const refreshToken = tokenSet.refresh_token as string | undefined;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new ValidationError('No access token in Google response');
  }
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
    // Require offline access; callers should initiate with prompt=consent + access_type=offline
    throw new ValidationError('No refresh token in Google response');
  }

  const info: any = await client.userinfo(tokenSet);
  const email = info?.email as string | undefined;
  if (!email) throw new ValidationError('Google profile missing email address');
  const expiresIn = tokenSet.expires_in as number | undefined;
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new ValidationError('Google response missing expires_in');
  }
  const account: Account = createAccount({
    id: email,
    provider: 'gmail',
    email,
    signature: '',
    tokens: {
      accessToken,
      refreshToken,
      expiry: new Date(Date.now() + expiresIn * 1000).toISOString(),
    },
  });
  
  logger.info('About to upsert Google account', { email, hasAccessToken: !!tokenSet.access_token, hasRefreshToken: !!tokenSet.refresh_token });
  const ctx = ensureContext(req);
  await upsertAccount(ctx, account);
  logger.info('Google account upserted successfully', { email });
  return account;
}
