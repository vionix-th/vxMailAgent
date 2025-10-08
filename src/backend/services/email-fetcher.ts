import { LiveRepos } from '../liveRepos';
import { beginSpan, endSpan, beginTrace, endTrace } from './logging';
import { EmailProcessor, EmailProcessingContext } from './email-processor';
import { ValidationError } from './error-handler';
import { EmailEnvelope } from '../../shared/types';
import { createEmailEnvelope, mergeEmailEnvelope } from '../../shared/constructors';
import { AccountManager } from './account-manager';
import { getMailProvider } from '../providers/mail';
import { PROVIDER_REQUEST_TIMEOUT_MS } from '../config';
import { newId } from '../utils/id';
import type { ReqLike } from '../interfaces';

export interface FetchContext {
  userReq: ReqLike;
  settings: any;
  filters: any[];
  directors: any[];
  agents: any[];
  accounts: any[];
  onAccountSuccess?: (accountId: string) => void;
  onAccountError?: (accountId: string, error: string) => void;
}

interface AccountProcessResult {
  success: boolean;
  error?: string;
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
    const { userReq, settings, filters, directors, agents, accounts, onAccountSuccess, onAccountError } = context;
    const fetchStart = new Date().toISOString();
    const runId = newId();

    this.logFetch({
      id: newId(),
      timestamp: fetchStart,
      level: 'info',
      provider: 'system',
      accountId: 'all',
      event: 'fetch_cycle_start',
      message: 'Starting email fetch cycle',
      runId,
      accountCount: accounts.length
    });

    for (const account of accounts) {
      const result = await this.processAccountEmails({
        account,
        userReq,
        settings,
        filters,
        directors,
        agents,
        fetchStart,
        runId
      });
      if (result.success) {
        onAccountSuccess?.(account.id);
      } else {
        onAccountError?.(account.id, result.error || 'account_processing_failed');
      }
    }

    this.logFetch({
      id: newId(),
      timestamp: new Date().toISOString(),
      level: 'info',
      provider: 'system',
      accountId: 'all',
      event: 'fetch_cycle_complete',
      message: 'Completed email fetch cycle',
      runId
    });
  }

  /**
   * Process emails for a single account.
  */
  private async processAccountEmails(context: {
    account: any;
    userReq: ReqLike;
    settings: any;
    filters: any[];
    directors: any[];
    agents: any[];
    fetchStart: string;
    runId: string;
  }): Promise<AccountProcessResult> {
    const { account, userReq, settings, filters, directors, agents, runId } = context;
    const accountTraceId = beginTrace({ accountId: account.id, provider: account.provider }, userReq);

    try {
      // Refresh OAuth token if needed
      const tokenResult = await this.accountManager.refreshTokenIfNeeded({
        account,
        userReq,
        traceId: accountTraceId
      });

      if (!tokenResult.success) {
        const errorMessage = tokenResult.error || 'token_refresh_failed';
        endTrace(accountTraceId, 'error', errorMessage, userReq);
        return { success: false, error: errorMessage };
      }

      // Fetch unread emails
      const envelopes = await this.fetchUnreadEmails(account, accountTraceId, userReq);
      if (!envelopes) {
        const errorMessage = 'failed_to_fetch_emails';
        endTrace(accountTraceId, 'error', errorMessage, userReq);
        return { success: false, error: errorMessage };
      }

      // Persist/merge envelopes into the email store (source of truth for UI)
      await this.upsertEmails(envelopes, userReq);

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
          accountTraceId,
          runId
        });
      }

      endTrace(accountTraceId, 'ok', 'Account processing completed', userReq);
      return { success: true };

    } catch (error: any) {
      const errorMessage = typeof error?.message === 'string' && error.message
        ? error.message
        : String(error ?? 'account_processing_error');
      endTrace(accountTraceId, 'error', errorMessage, userReq);
      this.logFetch({
        id: newId(),
        timestamp: new Date().toISOString(),
        level: 'error',
        provider: account.provider,
        accountId: account.id,
        event: 'account_processing_error',
        message: 'Failed to process account emails',
        detail: errorMessage
      });
      return { success: false, error: errorMessage };
    }
  }

  /** Upsert email envelopes by id into the per-user email store. */
  private async upsertEmails(envelopes: EmailEnvelope[], userReq: ReqLike): Promise<void> {
    if (!Array.isArray(envelopes) || envelopes.length === 0) return;
    const existing = await this.repos.getEmails(userReq);
    const byId = new Map<string, EmailEnvelope>(existing.map(e => [e.id, e] as const));
    const toPersist: EmailEnvelope[] = [];
    let added = 0, updated = 0;
    for (const env of envelopes) {
      const prev = byId.get(env.id);
      if (!prev) {
        byId.set(env.id, env);
        toPersist.push(env);
        added++;
      } else {
        const merged = mergeEmailEnvelope(prev, env);
        byId.set(env.id, merged);
        toPersist.push(merged);
        updated++;
      }
    }
    await this.repos.upsertEmails(userReq, toPersist);
    this.logFetch({
      id: newId(),
      timestamp: new Date().toISOString(),
      level: 'info',
      provider: 'system',
      accountId: 'all',
      event: 'emails_upserted',
      message: 'Upserted emails into store',
      added,
      updated
    });
  }

  /**
   * Fetch unread emails from provider with timeout.
   */
  private async fetchUnreadEmails(
    account: any,
    traceId: string,
    userReq: ReqLike
  ): Promise<EmailEnvelope[] | null> {
    const provider = getMailProvider(account.provider);
    if (!provider) {
      this.logFetch({
        id: newId(),
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

      const providerEnvelopes = await Promise.race([fetchPromise, timeoutPromise]);

      endSpan(traceId, sList, { status: 'ok', response: { count: providerEnvelopes.length } }, userReq);

      // Re-validate using domain constructor to enforce invariants without object literals.
      const valid: EmailEnvelope[] = [];
      for (const raw of providerEnvelopes as any[]) {
        try {
          const env = createEmailEnvelope({
            id: (raw as any)?.id,
            subject: (raw as any)?.subject,
            from: (raw as any)?.from,
            to: (raw as any)?.to,
            cc: (raw as any)?.cc,
            bcc: (raw as any)?.bcc,
            date: (raw as any)?.date,
            snippet: (raw as any)?.snippet,
            bodyPlain: (raw as any)?.bodyPlain,
            bodyHtml: (raw as any)?.bodyHtml,
            attachments: (raw as any)?.attachments,
          });
          valid.push(env);
        } catch (e: any) {
          this.logFetch({
            id: newId(),
            timestamp: new Date().toISOString(),
            level: 'error',
            provider: account.provider,
            accountId: account.id,
            emailId: typeof (raw as any)?.id === 'string' ? (raw as any).id : undefined,
            event: 'invalid_envelope_error',
            message: 'Envelope failed invariants',
            detail: { error: e?.message }
          });
          throw new ValidationError(`Provider returned invalid email envelope: ${e?.message || 'unknown error'}`, 'PROVIDER_INVALID_ENVELOPE', 502);
        }
      }

      this.logFetch({
        timestamp: new Date().toISOString(),
        level: 'info',
        provider: account.provider,
        accountId: account.id,
        event: 'messages_listed',
        message: 'Listed unread messages (post-validation)',
        count: valid.length,
      });

      return valid;

    } catch (error: any) {
      endSpan(traceId, sList, { status: 'error', error: error.message }, userReq);
      
      this.logFetch({
        id: newId(),
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
    userReq: ReqLike;
    accountTraceId: string;
    runId: string;
  }): Promise<void> {
    const { envelope, account, filters, directors, agents, prompts, apiConfigs, userReq, runId } = context;
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
        runId,
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
