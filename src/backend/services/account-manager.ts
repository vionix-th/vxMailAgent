import { LiveRepos } from '../liveRepos';
import { beginSpan, endSpan } from './logging';
import { getMailProvider } from '../providers/mail';
import logger from './logger';
import { newId } from '../utils/id';
import type { ReqLike } from '../interfaces';

export interface AccountContext {
  account: any;
  userReq: ReqLike;
  traceId: string;
}

export interface TokenRefreshResult {
  success: boolean;
  updated: boolean;
  error?: string;
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

    if (!account.tokens?.refreshToken) {
      return { success: true, updated: false };
    }

    const sRefresh = beginSpan(traceId, {
      type: 'llm_call',
      name: 'refreshOAuthToken',
      provider: account.provider
    }, userReq);

    try {
      const provider = getMailProvider(account.provider);
      if (!provider) {
        throw new Error(`Unsupported provider: ${account.provider}`);
      }
      const refreshResult = await provider.ensureValidAccessToken(account);

      if (refreshResult.updated) {
        const validated = this.requireRefreshedTokens(account, refreshResult);

        // Mutate in-memory account tokens immediately so the current fetch cycle
        // uses the fresh access token without requiring a second run
        try {
          account.tokens = {
            ...account.tokens,
            accessToken: validated.accessToken,
            expiry: validated.expiry,
            refreshToken: validated.refreshToken,
          };
        } catch (e: any) {
          logger.warn('ACCOUNT_MANAGER failed to update in-memory tokens', {
            error: e?.message || String(e),
            accountId: account?.id,
            provider: account?.provider,
          });
        }

        await this.persistTokenUpdate(account, validated, userReq);
        
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
        updated: refreshResult.updated
      };

    } catch (error: any) {
      endSpan(traceId, sRefresh, { 
        status: 'error', 
        error: error.message 
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
        detail: error.message
      });

      return {
        success: false,
        updated: false,
        error: error.message
      };
    }
  }

  /**
   * Validate refreshed OAuth tokens and enforce non-empty invariants.
   */
  private requireRefreshedTokens(
    _account: any,
    refreshed: any
  ): { accessToken: string; refreshToken: string; expiry: string } {
    const accessToken = typeof refreshed?.accessToken === 'string' ? refreshed.accessToken : undefined;
    if (!accessToken || accessToken.trim().length === 0) {
      throw new Error('provider refresh returned invalid access token');
    }
    const refreshToken = typeof refreshed?.refreshToken === 'string' ? refreshed.refreshToken : undefined;
    if (!refreshToken || refreshToken.trim().length === 0) {
      throw new Error('provider refresh returned invalid refresh token');
    }
    const expiry = typeof refreshed?.expiry === 'string' ? refreshed.expiry : undefined;
    if (!expiry || expiry.trim().length === 0) {
      throw new Error('provider refresh returned invalid expiry timestamp');
    }
    const parsed = Date.parse(expiry);
    if (Number.isNaN(parsed)) {
      throw new Error('provider refresh returned unparsable expiry timestamp');
    }
    return { accessToken, refreshToken, expiry };
  }

  /**
   * Persist updated OAuth tokens to repository.
   */
  private async persistTokenUpdate(
    account: any,
    tokens: { accessToken: string; refreshToken: string; expiry: string },
    userReq: ReqLike
  ): Promise<void> {
    await this.repos.updateAccountTokens(userReq, account.id, tokens);
  }
}
