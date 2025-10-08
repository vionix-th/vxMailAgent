import { ConversationThread, Agent, Director, Filter, Prompt, EmailEnvelope } from '../../shared/types';
import { LiveRepos } from '../liveRepos';
import { evaluateFilters, selectDirectorTriggers } from './orchestration-director';
import { ConversationOrchestrator, createUserRequest } from './conversation-orchestrator';
import { repoFinalizeThreadStatus } from './conversation-mutations';
import type { ReqLike } from '../interfaces';
import { newId } from '../utils/id';
import { beginSpan, endSpan } from './logging';
import { ValidationError } from './error-handler';

export interface EmailProcessingContext {
  envelope: EmailEnvelope;
  account: any;
  traceId: string;
  runId: string;
  filters: Filter[];
  directors: Director[];
  agents: Agent[];
  prompts: Prompt[];
  apiConfigs: any[];
}

export interface ProcessingResult {
  conversationsCreated: string[];
  directorsTriggered: string[];
  success: boolean;
  error?: string;
}

/**
 * Core email processing pipeline - handles single email through filter evaluation
 * and director triggering without mixing concerns.
 */
export class EmailProcessor {
  constructor(
    private repos: LiveRepos,
    private logFetch: (entry: any) => void
  ) {}

  /**
   * Process a single email envelope through the complete pipeline.
   */
  async processEmail(
    context: EmailProcessingContext,
    userReq: ReqLike
  ): Promise<ProcessingResult> {
    const { envelope, account, traceId, filters, directors } = context;
    const result: ProcessingResult = {
      conversationsCreated: [],
      directorsTriggered: [],
      success: true
    };

    try {
      // Filter evaluation phase
      const filterEvaluations = await this.evaluateEmailFilters(
        envelope, 
        filters, 
        traceId, 
        userReq
      );

      // Director selection phase  
      const directorTriggers = await this.selectTriggeredDirectors(
        filterEvaluations,
        traceId,
        userReq
      );

      result.directorsTriggered = directorTriggers;

      // Director thread creation phase
      for (const directorId of directorTriggers) {
        const director = directors.find(d => d.id === directorId);
        if (!director) continue;

        const threadId = await this.createDirectorThread(
          director,
          envelope,
          context,
          traceId,
          userReq
        );

        if (threadId) {
          result.conversationsCreated.push(threadId);
        }
      }

      return result;
    } catch (error: any) {
      result.success = false;
      result.error = error.message;
      this.logFetch({
        id: newId(),
        timestamp: new Date().toISOString(),
        level: 'error',
        provider: account.provider,
        accountId: account.id,
        event: 'email_processing_error',
        message: 'Failed to process email',
        detail: error.message
      });
      return result;
    }
  }

  /**
   * Evaluate filters against email content.
   */
  private async evaluateEmailFilters(
    envelope: EmailEnvelope,
    filters: Filter[],
    traceId: string,
    userReq: ReqLike
  ): Promise<any[]> {
    this.ensureFilterContext(envelope);

    const sFilters = beginSpan(traceId, {
      type: 'filters_eval',
      name: 'evaluateFilters',
      provider: 'gmail',
      emailId: envelope.id,
      request: { filtersCount: filters.length }
    }, userReq);

    const ctx: any = {
      from: envelope.from,
      subject: envelope.subject,
    };
    if (typeof envelope.to === 'string') ctx.to = envelope.to;
    if (typeof envelope.cc === 'string') ctx.cc = envelope.cc;
    if (typeof envelope.bcc === 'string') ctx.bcc = envelope.bcc;
    if (typeof envelope.bodyPlain === 'string') ctx.bodyPlain = envelope.bodyPlain;
    if (typeof envelope.bodyHtml === 'string') ctx.bodyHtml = envelope.bodyHtml;
    if (typeof envelope.snippet === 'string') ctx.snippet = envelope.snippet;
    if (typeof envelope.date === 'string') ctx.date = envelope.date;
    const filterEvaluations = evaluateFilters(filters, ctx as any);

    endSpan(traceId, sFilters, {
      status: 'ok',
      response: { matches: filterEvaluations.filter(e => e.match).length }
    }, userReq);

    return filterEvaluations;
  }

  private ensureFilterContext(envelope: EmailEnvelope): void {
    const checks: Array<[string, unknown]> = [
      ['email.from', envelope.from],
      ['email.subject', envelope.subject],
      ['email.to', envelope.to],
      ['email.date', envelope.date],
    ];
    for (const [label, value] of checks) {
      if (typeof value !== 'string' || !value.trim()) {
        throw new ValidationError(`Filter context ${label} missing`, 'EMAIL_FILTER_CONTEXT_MISSING');
      }
    }
    const hasBody = typeof envelope.bodyPlain === 'string' && envelope.bodyPlain.trim().length > 0;
    const hasHtml = typeof envelope.bodyHtml === 'string' && envelope.bodyHtml.trim().length > 0;
    const hasSnippet = typeof envelope.snippet === 'string' && envelope.snippet.trim().length > 0;
    if (!hasBody && !hasHtml && !hasSnippet) {
      throw new ValidationError('Filter context missing email body content', 'EMAIL_FILTER_CONTEXT_BODY_MISSING');
    }
  }

  /**
   * Select directors that should be triggered based on filter results.
   */
  private async selectTriggeredDirectors(
    filterEvaluations: any[],
    traceId: string,
    userReq: ReqLike
  ): Promise<string[]> {
    const sSelect = beginSpan(traceId, {
      type: 'director_select',
      name: 'selectDirectorTriggers',
      provider: 'gmail'
    }, userReq);

    const directorTriggers = selectDirectorTriggers(filterEvaluations);

    endSpan(traceId, sSelect, {
      status: 'ok',
      response: { triggers: directorTriggers }
    }, userReq);

    return directorTriggers;
  }

  /**
   * Create a director conversation thread for the email.
   */
  private async createDirectorThread(
    director: Director,
    envelope: EmailEnvelope,
    context: EmailProcessingContext,
    traceId: string,
    userReq: ReqLike
  ): Promise<string | null> {
    // Validate director configuration
    const validation = this.validateDirectorConfig(director, context);
    if (!validation.isValid) {
      this.logDirectorConfigError(director.id, context.account, validation.error!);
      return null;
    }

    // Create and persist thread
    const thread = this.buildDirectorThread(director, envelope, context);
    const persistedThread = await this.persistDirectorThread(thread, traceId, userReq);

    // Log successful creation
    this.logDirectorThreadCreated(director.id, persistedThread.id, context.account);

    // Start orchestration asynchronously
    this.startDirectorOrchestration(persistedThread, director, context, userReq);

    return persistedThread.id;
  }

  private validateDirectorConfig(director: Director, context: EmailProcessingContext): { isValid: boolean; error?: string } {
    const { prompts, apiConfigs } = context;
    
    const directorPrompt = prompts.find(p => p.id === director.promptId);
    const directorApi = apiConfigs.find(c => c.id === director.apiConfigId);

    if (!directorApi) {
      return { isValid: false, error: 'Missing director apiConfig' };
    }
    if (!directorPrompt) {
      return { isValid: false, error: 'Missing director prompt' };
    }
    
    return { isValid: true };
  }

  private buildDirectorThread(
    director: Director,
    envelope: EmailEnvelope,
    context: EmailProcessingContext
  ): ConversationThread {
    const directorPrompt = context.prompts.find(p => p.id === director.promptId)!;
    const dirThreadId = newId();
    const nowIso = new Date().toISOString();

    // Initial transcript = prompt messages + email context as user message
    const emailContextContent = `Email context
subject: ${envelope.subject}
from: ${envelope.from}
date: ${envelope.date}
snippet: ${envelope.snippet}`;
    const initialMessages = [
      ...directorPrompt.messages,
      { role: 'user', content: emailContextContent } as any,
    ];

    const dirThread: ConversationThread = {
      id: dirThreadId,
      kind: 'director',
      parentId: null,
      accountId: context.account.id,
      directorId: director.id,
      agentId: null,
      email: envelope,
      promptId: directorPrompt.id,
      apiConfigId: director.apiConfigId,
      startedAt: nowIso,
      status: 'ongoing',
      endedAt: null,
      lastActiveAt: nowIso,
      messages: initialMessages,
      errors: [],
    } as ConversationThread;

    return dirThread;
  }

  private async persistDirectorThread(
    thread: ConversationThread,
    traceId: string,
    userReq: ReqLike
  ): Promise<ConversationThread> {
    const persistedThread = await this.repos.appendConversation(userReq, thread);

    const sConvCreate = beginSpan(traceId, {
      type: 'conversation_update',
      name: 'create_director_thread',
      emailId: persistedThread.email.id,
      directorId: persistedThread.directorId
    }, userReq);

    endSpan(traceId, sConvCreate, { status: 'ok' }, userReq);

    return persistedThread;
  }

  private logDirectorConfigError(directorId: string, account: any, error: string): void {
    this.logFetch({
      id: newId(),
      timestamp: new Date().toISOString(),
      level: 'error',
      provider: account.provider,
      accountId: account.id,
      event: 'director_config_missing',
      message: error,
      directorId
    });
  }

  private logDirectorThreadCreated(directorId: string, threadId: string, account: any): void {
    this.logFetch({
      id: newId(),
      timestamp: new Date().toISOString(),
      level: 'info',
      provider: account.provider,
      accountId: account.id,
      event: 'director_thread_created',
      message: 'Created director conversation thread',
      directorId,
      threadId
    });
  }

  private startDirectorOrchestration(
    thread: ConversationThread,
    director: Director,
    context: EmailProcessingContext,
    userReq: ReqLike
  ): void {
    const orchestratorUserReq = createUserRequest(userReq, this.repos);
    const orchestrator = new ConversationOrchestrator(userReq, context.runId, context.account.id);
    
    // Start orchestration asynchronously - don't block email processing
    setImmediate(async () => {
      try {
        await orchestrator.runConversationLoop({
          thread,
          director,
          traceId: context.traceId,
          agents: context.agents,
          apiConfigs: context.apiConfigs,
          prompts: context.prompts
        }, orchestratorUserReq, 6);
      } catch (error: any) {
        const orchestrationErrorMessage = error?.message || String(error);
        let finalizeErrorMessage: string | undefined;
        try {
          await repoFinalizeThreadStatus(
            orchestratorUserReq.repos,
            orchestratorUserReq.reqLike,
            thread.id,
            'failed'
          );
        } catch (finalizeError: any) {
          finalizeErrorMessage = finalizeError?.message || String(finalizeError);
        }

        this.logFetch({
          id: newId(),
          timestamp: new Date().toISOString(),
          level: 'error',
          provider: context.account.provider,
          accountId: context.account.id,
          event: 'orchestration_error',
          message: 'Failed to start director orchestration',
          directorId: director.id,
          threadId: thread.id,
          detail: orchestrationErrorMessage,
          ...(finalizeErrorMessage ? { finalizeError: finalizeErrorMessage } : {})
        });
      }
    });
  }
}
