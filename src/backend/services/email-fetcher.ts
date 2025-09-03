import { LiveRepos } from '../liveRepos';
import { UserRequest } from '../middleware/user-context';
import { beginSpan, endSpan, beginTrace, endTrace } from './logging';
import { EmailProcessor, EmailEnvelope, EmailProcessingContext } from './email-processor';
import { AccountManager } from './account-manager';
import { getMailProvider } from '../providers/mail';
import { PROVIDER_REQUEST_TIMEOUT_MS } from '../config';

export interface FetchContext {
  userReq: UserRequest;
  settings: any;
  filters: any[];
  directors: any[];
  agents: any[];
  accounts: any[];
}

/**
 * Refactored email fetcher with clear separation of concerns.
 * Orchestrates the email fetching pipeline without mixing business logic.
 */
export class EmailFetcher {
  private emailProcessor: EmailProcessor;
  private accountManager: AccountManager;
  constructor(
    private repos: LiveRepos,
    private logFetch: (entry: any) => void
  ) {
    this.emailProcessor = new EmailProcessor(repos, logFetch);
    this.accountManager = new AccountManager(repos, logFetch);
  }

  /**
   * Main entry point for email fetching and processing.
   */
  async fetchEmails(context: FetchContext): Promise<void> {
    const { userReq, settings, filters, directors, agents, accounts } = context;
    const fetchStart = new Date().toISOString();

    this.logFetch({
      timestamp: fetchStart,
      level: 'info',
      provider: 'system',
      accountId: 'all',
      event: 'fetch_cycle_start',
      message: 'Starting email fetch cycle',
      accountCount: accounts.length
    });

    for (const account of accounts) {
      await this.processAccountEmails({
        account,
        userReq,
        settings,
        filters,
        directors,
        agents,
        fetchStart
      });
    }

    this.logFetch({
      timestamp: new Date().toISOString(),
      level: 'info',
      provider: 'system',
      accountId: 'all',
      event: 'fetch_cycle_complete',
      message: 'Completed email fetch cycle'
    });
  }

  /**
   * Process emails for a single account.
   */
  private async processAccountEmails(context: {
    account: any;
    userReq: UserRequest;
    settings: any;
    filters: any[];
    directors: any[];
    agents: any[];
    fetchStart: string;
  }): Promise<void> {
    const { account, userReq, settings, filters, directors, agents } = context;
    const accountTraceId = beginTrace({ accountId: account.id, provider: account.provider }, userReq);

    try {
      // Refresh OAuth token if needed
      const tokenResult = await this.accountManager.refreshTokenIfNeeded({
        account,
        userReq,
        traceId: accountTraceId
      });

      if (!tokenResult.success) {
        endTrace(accountTraceId, 'error', tokenResult.error || 'Token refresh failed', userReq);
        return;
      }

      // Fetch unread emails
      const envelopes = await this.fetchUnreadEmails(account, accountTraceId, userReq);
      if (!envelopes) {
        endTrace(accountTraceId, 'error', 'Failed to fetch emails', userReq);
        return;
      }

      // Process each email
      const prompts = await this.repos.getPrompts(userReq);
      for (const envelope of envelopes) {
        await this.processSingleEmail({
          envelope,
          account,
          filters,
          directors,
          agents,
          prompts,
          apiConfigs: settings.apiConfigs,
          userReq,
          accountTraceId
        });
      }

      endTrace(accountTraceId, 'ok', 'Account processing completed', userReq);

    } catch (error: any) {
      endTrace(accountTraceId, 'error', error.message, userReq);
      this.logFetch({
        timestamp: new Date().toISOString(),
        level: 'error',
        provider: account.provider,
        accountId: account.id,
        event: 'account_processing_error',
        message: 'Failed to process account emails',
        detail: error.message
      });
    }
  }

  /**
   * Fetch unread emails from provider with timeout.
   */
  private async fetchUnreadEmails(
    account: any,
    traceId: string,
    userReq: UserRequest
  ): Promise<EmailEnvelope[] | null> {
    const provider = getMailProvider(account.provider);
    if (!provider) {
      this.logFetch({
        timestamp: new Date().toISOString(),
        level: 'error',
        provider: account.provider,
        accountId: account.id,
        event: 'provider_not_found',
        message: 'Email provider not found'
      });
      return null;
    }

    const sList = beginSpan(traceId, {
      type: 'provider_fetch',
      name: 'fetchUnread',
      provider: account.provider
    }, userReq);

    try {
      const fetchPromise = provider.fetchUnread(account, { max: 10, unreadOnly: true });
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`provider_fetch_timeout_${PROVIDER_REQUEST_TIMEOUT_MS}ms`)),
          Math.max(1, PROVIDER_REQUEST_TIMEOUT_MS || 0));
      });

      const envelopes = await Promise.race([fetchPromise, timeoutPromise]);
      
      endSpan(traceId, sList, { status: 'ok', response: { count: envelopes.length } }, userReq);
      
      this.logFetch({
        timestamp: new Date().toISOString(),
        level: 'info',
        provider: account.provider,
        accountId: account.id,
        event: 'messages_listed',
        message: 'Listed unread messages',
        count: envelopes.length
      });

      return envelopes.map((env: any) => ({
        id: env.id,
        subject: String(env.subject || ''),
        from: String(env.from || ''),
        date: String(env.date || ''),
        snippet: String(env.snippet || ''),
        bodyPlain: env.bodyPlain,
        bodyHtml: env.bodyHtml,
        attachments: []
      }));

    } catch (error: any) {
      endSpan(traceId, sList, { status: 'error', error: error.message }, userReq);
      
      this.logFetch({
        timestamp: new Date().toISOString(),
        level: 'error',
        provider: account.provider,
        accountId: account.id,
        event: 'provider_fetch_error',
        message: 'Failed to list unread messages',
        detail: error.message
      });

      return null;
    }
  }

  /**
   * Process a single email through the complete pipeline.
   */
  private async processSingleEmail(context: {
    envelope: EmailEnvelope;
    account: any;
    filters: any[];
    directors: any[];
    agents: any[];
    prompts: any[];
    apiConfigs: any[];
    userReq: UserRequest;
    accountTraceId: string;
  }): Promise<void> {
    const { envelope, account, filters, directors, agents, prompts, apiConfigs, userReq } = context;
    const emailTraceId = beginTrace({
      emailId: envelope.id,
      accountId: account.id,
      provider: account.provider
    }, userReq);

    try {
      const processingContext: EmailProcessingContext = {
        envelope,
        account,
        traceId: emailTraceId,
        filters,
        directors,
        agents,
        prompts,
        apiConfigs
      };

      const result = await this.emailProcessor.processEmail(processingContext, userReq);
      
      if (result.success) {
        endTrace(emailTraceId, 'ok', 'Email processed successfully', userReq);
      } else {
        endTrace(emailTraceId, 'error', result.error || 'Processing failed', userReq);
      }

    } catch (error: any) {
      endTrace(emailTraceId, 'error', error.message, userReq);
    }
  }
}
