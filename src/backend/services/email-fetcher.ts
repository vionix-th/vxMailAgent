import { LiveRepos } from '../liveRepos';
import { UserRequest } from '../middleware/user-context';
import { beginSpan, endSpan, beginTrace, endTrace } from './logging';
import { EmailProcessor, EmailProcessingContext } from './email-processor';
import { EmailEnvelope } from '../../shared/types';
import { AccountManager } from './account-manager';
import { getMailProvider } from '../providers/mail';
import { PROVIDER_REQUEST_TIMEOUT_MS } from '../config';
import { newId } from '../utils/id';

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
    const runId = newId();

    this.logFetch({
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
      await this.processAccountEmails({
        account,
        userReq,
        settings,
        filters,
        directors,
        agents,
        fetchStart,
        runId
      });
    }

    this.logFetch({
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
    userReq: UserRequest;
    settings: any;
    filters: any[];
    directors: any[];
    agents: any[];
    fetchStart: string;
    runId: string;
  }): Promise<void> {
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
        endTrace(accountTraceId, 'error', tokenResult.error || 'Token refresh failed', userReq);
        return;
      }

      // Fetch unread emails
      const envelopes = await this.fetchUnreadEmails(account, accountTraceId, userReq);
      if (!envelopes) {
        endTrace(accountTraceId, 'error', 'Failed to fetch emails', userReq);
        return;
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

  /** Upsert email envelopes by id into the per-user email store. */
  private async upsertEmails(envelopes: EmailEnvelope[], userReq: UserRequest): Promise<void> {
    if (!Array.isArray(envelopes) || envelopes.length === 0) return;
    const existing = await this.repos.getEmails(userReq);
    const byId = new Map<string, EmailEnvelope>(existing.map(e => [e.id, e] as const));
    let added = 0, updated = 0;
    for (const env of envelopes) {
      const prev = byId.get(env.id);
      if (!prev) {
        byId.set(env.id, env);
        added++;
      } else {
        // Prefer newest fields (simple replace)
        byId.set(env.id, { ...prev, ...env });
        updated++;
      }
    }
    await this.repos.setEmails(userReq, Array.from(byId.values()));
    this.logFetch({
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

      const providerEnvelopes = await Promise.race([fetchPromise, timeoutPromise]);

      endSpan(traceId, sList, { status: 'ok', response: { count: providerEnvelopes.length } }, userReq);

      // Validate required fields: subject, from, to, date (no synthesis/coercion).
      const valid: EmailEnvelope[] = [];
      let dropped = 0;
      for (const raw of providerEnvelopes as EmailEnvelope[]) {
        const env: EmailEnvelope = {
          id: String((raw as any).id),
          subject: typeof raw.subject === 'string' ? raw.subject.trim() : '',
          from: typeof raw.from === 'string' ? raw.from.trim() : '',
          to: typeof (raw as any).to === 'string' ? (raw as any).to.trim() : '',
          ...(raw.cc ? { cc: String(raw.cc).trim() } : {}),
          ...(raw.bcc ? { bcc: String(raw.bcc).trim() } : {}),
          date: typeof raw.date === 'string' ? raw.date.trim() : '',
          ...(raw.snippet ? { snippet: String(raw.snippet) } : {}),
          ...(raw.bodyPlain ? { bodyPlain: raw.bodyPlain } : {}),
          ...(raw.bodyHtml ? { bodyHtml: raw.bodyHtml } : {}),
          ...(Array.isArray(raw.attachments) ? { attachments: raw.attachments } : {}),
        };

        const missing: string[] = [];
        if (!env.subject) missing.push('subject');
        if (!env.from) missing.push('from');
        if (!env.to) missing.push('to');
        if (!env.date) missing.push('date');

        // Validate date is parseable
        let invalidDate = false;
        if (env.date) {
          const t = Date.parse(env.date);
          invalidDate = Number.isNaN(t);
        }

        if (missing.length > 0 || invalidDate) {
          dropped++;
          this.logFetch({
            timestamp: new Date().toISOString(),
            level: 'warn',
            provider: account.provider,
            accountId: account.id,
            emailId: env.id,
            event: 'invalid_envelope_dropped',
            message: 'Envelope failed invariants and was dropped',
            detail: { missing, invalidDate, sample: { subject: env.subject, from: env.from, to: env.to, date: env.date } },
          });
          continue;
        }

        valid.push(env);
      }

      this.logFetch({
        timestamp: new Date().toISOString(),
        level: dropped > 0 ? 'warn' : 'info',
        provider: account.provider,
        accountId: account.id,
        event: 'messages_listed',
        message: 'Listed unread messages (post-validation)',
        count: valid.length,
        detail: dropped > 0 ? { dropped } : undefined,
      });

      return valid;

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
