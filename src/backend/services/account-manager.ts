import { LiveRepos } from '../liveRepos';
import { UserRequest } from '../middleware/user-context';
import { beginSpan, endSpan } from './logging';
import { getMailProvider } from '../providers/mail';

export interface AccountContext {
  account: any;
  userReq: UserRequest;
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

      if (refreshResult.error) {
        endSpan(traceId, sRefresh, { 
          status: 'error', 
          error: refreshResult.error 
        }, userReq);

        this.logFetch({
          timestamp: new Date().toISOString(),
          level: 'error',
          provider: account.provider,
          accountId: account.id,
          event: 'oauth_refresh_failed',
          message: 'Failed to refresh OAuth token',
          detail: refreshResult.error
        });

        return {
          success: false,
          updated: false,
          error: refreshResult.error
        };
      }

      if (refreshResult.updated) {
        await this.persistTokenUpdate(account, refreshResult, userReq);
        
        this.logFetch({
          timestamp: new Date().toISOString(),
          level: 'info',
          provider: account.provider,
          accountId: account.id,
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
        timestamp: new Date().toISOString(),
        level: 'error',
        provider: account.provider,
        accountId: account.id,
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
   * Persist updated OAuth tokens to repository.
   */
  private async persistTokenUpdate(
    account: any,
    refreshResult: any,
    userReq: UserRequest
  ): Promise<void> {
    const accounts = await this.repos.getAccounts(userReq);
    const accountIndex = accounts.findIndex((a: any) => a.id === account.id);
    
    if (accountIndex !== -1) {
      const updatedAccount = {
        ...accounts[accountIndex],
        tokens: {
          ...accounts[accountIndex].tokens,
          accessToken: refreshResult.accessToken,
          expiry: refreshResult.expiry,
          refreshToken: refreshResult.refreshToken || accounts[accountIndex].tokens.refreshToken
        }
      };

      const updatedAccounts = [
        ...accounts.slice(0, accountIndex),
        updatedAccount,
        ...accounts.slice(accountIndex + 1)
      ];

      await this.repos.setAccounts(userReq, updatedAccounts);
    }
  }
}
