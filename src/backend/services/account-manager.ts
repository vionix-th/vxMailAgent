import { LiveRepos } from '../liveRepos';
import { beginSpan, endSpan } from './logging';
import { getMailProvider } from '../providers/mail';
import logger from './logger';
import { newId } from '../utils/id';
import type { ContextInput } from '../utils/repo-access';
import { ValidationError } from './error-handler';

export interface OAuthTokenBundle {
  accessToken: string;
  refreshToken: string;
  expiry: string;
}

export function enforceOAuthTokenInvariants(
  source: 'persisted' | 'refreshed',
  payload: any
): OAuthTokenBundle {
  if (!payload || typeof payload !== 'object') {
    if (source === 'persisted') {
      throw new ValidationError('missing_refresh_token', 'OAUTH_MISSING_REFRESH_TOKEN', 401);
    }
    throw new ValidationError('invalid_refresh_payload', 'OAUTH_INVALID_REFRESH_PAYLOAD', 502);
  }

  const accessToken = requireTokenField('accessToken', payload.accessToken);
  const refreshToken = requireTokenField('refreshToken', payload.refreshToken);
  const expiry = requireTokenField('expiry', payload.expiry);

  const parsed = Date.parse(expiry);
  if (Number.isNaN(parsed)) {
    throw new ValidationError('invalid_token_expiry', 'OAUTH_INVALID_TOKEN_EXPIRY', 400);
  }

  return { accessToken, refreshToken, expiry };
}

function requireTokenField(
  field: 'accessToken' | 'refreshToken' | 'expiry',
  value: any
): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized.length === 0) {
    if (field === 'refreshToken') {
      throw new ValidationError('missing_refresh_token', 'OAUTH_MISSING_REFRESH_TOKEN', 401);
    }
    if (field === 'accessToken') {
      throw new ValidationError('missing_access_token', 'OAUTH_MISSING_ACCESS_TOKEN', 400);
    }
    throw new ValidationError('missing_expiry', 'OAUTH_MISSING_TOKEN_EXPIRY', 400);
  }
  return normalized;
}

const REAUTH_ERROR_CODES = new Set([
  'OAUTH_MISSING_REFRESH_TOKEN',
  'OAUTH_MISSING_ACCESS_TOKEN',
  'OAUTH_MISSING_TOKEN_EXPIRY',
  'OAUTH_INVALID_TOKEN_EXPIRY',
  'OAUTH_INVALID_REFRESH_PAYLOAD',
]);

const REAUTH_ERROR_MESSAGES = new Set([
  'missing_refresh_token',
  'missing_access_token',
  'missing_expiry',
  'invalid_token_expiry',
  'invalid_refresh_payload',
]);

export function isReauthTokenValidationError(error: unknown): boolean {
  if (!error) return false;
  const code = typeof (error as any)?.code === 'string' ? (error as any).code : undefined;
  if (code && REAUTH_ERROR_CODES.has(code)) {
    return true;
  }
  const message = typeof (error as any)?.message === 'string' ? (error as any).message : undefined;
  if (message && REAUTH_ERROR_MESSAGES.has(message)) {
    return true;
  }
  return false;
}

export interface AccountContext {
  account: any;
  userReq: ContextInput;
  traceId: string;
}

export interface TokenRefreshResult {
  success: boolean;
  updated: boolean;
  error?: string;
  reauthRequired?: boolean;
  reauthReason?: string;
}

/**
 * Handles account-specific operations like OAuth token refresh.
 * Extracted from fetcher service for better separation of concerns.
 */
export class AccountManager {
  constructor(
    private repos: LiveRepos,
    private logFetch: (entry: any) => void
  ) {}

  /**
   * Refresh OAuth token if needed and persist updates.
   */
  async refreshTokenIfNeeded(context: AccountContext): Promise<TokenRefreshResult> {
    const { account, userReq, traceId } = context;

    const sRefresh = beginSpan(traceId, {
      type: 'llm_call',
      name: 'refreshOAuthToken',
      provider: account.provider
    }, userReq);

    try {
      const persistedTokens = enforceOAuthTokenInvariants('persisted', account.tokens);
      account.tokens = persistedTokens;

      const provider = getMailProvider(account.provider);
      if (!provider) {
        throw new Error(`Unsupported provider: ${account.provider}`);
      }
      const refreshResult = await provider.ensureValidAccessToken(account);
      const validatedResult = enforceOAuthTokenInvariants('refreshed', refreshResult);

      // Mutate in-memory account tokens immediately so the current fetch cycle
      // uses validated credentials (refreshed or persisted)
      try {
        account.tokens = validatedResult;
      } catch (e: any) {
        logger.warn('ACCOUNT_MANAGER failed to update in-memory tokens', {
          error: e?.message || String(e),
          accountId: account?.id,
          provider: account?.provider,
        });
      }

      if (refreshResult.updated) {
        await this.persistTokenUpdate(account, validatedResult, userReq);

        this.logFetch({
          id: newId(),
          timestamp: new Date().toISOString(),
          level: 'info',
          provider: account.provider,
          accountId: account.id,
          emailId: null,
          event: 'oauth_refreshed',
          message: 'OAuth token refreshed successfully'
        });
      }

      endSpan(traceId, sRefresh, {
        status: 'ok',
        response: { updated: refreshResult.updated }
      }, userReq);

      return {
        success: true,
        updated: refreshResult.updated,
        reauthRequired: false
      };

    } catch (error: any) {
      const errorMessage = typeof error?.message === 'string' ? error.message : String(error ?? 'token_refresh_failed');
      const reauthRequired = isReauthTokenValidationError(error);

      endSpan(traceId, sRefresh, { 
        status: 'error', 
        error: errorMessage 
      }, userReq);

      this.logFetch({
        id: newId(),
        timestamp: new Date().toISOString(),
        level: 'error',
        provider: account.provider,
        accountId: account.id,
        emailId: null,
        event: 'oauth_refresh_failed',
        message: 'Failed to refresh OAuth token',
        detail: errorMessage
      });

      return {
        success: false,
        updated: false,
        error: errorMessage,
        reauthRequired,
        reauthReason: reauthRequired ? errorMessage : undefined
      };
    }
  }

  /**
   * Persist updated OAuth tokens to repository.
   */
  private async persistTokenUpdate(
    account: any,
    tokens: { accessToken: string; refreshToken: string; expiry: string },
    userReq: ContextInput
  ): Promise<void> {
    await this.repos.updateAccountTokens(userReq, account.id, tokens);
  }
}
