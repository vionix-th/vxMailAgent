import { ConversationThread, Agent, Director, Filter, Prompt, EmailEnvelope } from '../../shared/types';
import { LiveRepos } from '../liveRepos';
import { UserRequest } from '../middleware/user-context';
import { evaluateFilters, selectDirectorTriggers } from './orchestration-director';
import { ConversationOrchestrator, createUserRequest } from './conversation-orchestrator';
import type { ReqLike } from '../interfaces';
import { newId } from '../utils/id';
import { beginSpan, endSpan } from './logging';

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
    userReq: UserRequest
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
    userReq: UserRequest
  ): Promise<any[]> {
    const sFilters = beginSpan(traceId, {
      type: 'filters_eval',
      name: 'evaluateFilters',
      provider: 'gmail',
      emailId: envelope.id,
      request: { filtersCount: filters.length }
    }, userReq);

    const ctx = {
      from: envelope.from,
      to: envelope.to ?? undefined,
      cc: envelope.cc ?? undefined,
      bcc: envelope.bcc ?? undefined,
      subject: envelope.subject,
      bodyPlain: envelope.bodyPlain ?? undefined,
      bodyHtml: envelope.bodyHtml ?? undefined,
      snippet: envelope.snippet ?? undefined,
      date: envelope.date ?? undefined,
    };
    const filterEvaluations = evaluateFilters(filters, ctx as any);

    endSpan(traceId, sFilters, {
      status: 'ok',
      response: { matches: filterEvaluations.filter(e => e.match).length }
    }, userReq);

    return filterEvaluations;
  }

  /**
   * Select directors that should be triggered based on filter results.
   */
  private async selectTriggeredDirectors(
    filterEvaluations: any[],
    traceId: string,
    userReq: UserRequest
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
    userReq: UserRequest
  ): Promise<string | null> {
    // Validate director configuration
    const validation = this.validateDirectorConfig(director, context);
    if (!validation.isValid) {
      this.logDirectorConfigError(director.id, context.account, validation.error!);
      return null;
    }

    // Create and persist thread
    const thread = this.buildDirectorThread(director, envelope, context, traceId);
    await this.persistDirectorThread(thread, traceId, userReq);
    
    // Log successful creation
    this.logDirectorThreadCreated(director.id, thread.id, context.account);

    // Start orchestration asynchronously
    this.startDirectorOrchestration(thread, director, context, userReq);

    return thread.id;
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
    context: EmailProcessingContext,
    traceId: string
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
      traceId,
      email: envelope,
      promptId: directorPrompt.id,
      apiConfigId: context.apiConfigs.find(a => a.id === director.apiConfigId)?.id ?? director.apiConfigId,
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
    userReq: UserRequest
  ): Promise<void> {
    const conversations = await this.repos.getConversations(userReq);
    const updatedConversations = [...conversations, thread];
    await this.repos.setConversations(userReq, updatedConversations);

    const sConvCreate = beginSpan(traceId, {
      type: 'conversation_update',
      name: 'create_director_thread',
      emailId: thread.email.id,
      directorId: thread.directorId
    }, userReq);

    endSpan(traceId, sConvCreate, { status: 'ok' }, userReq);
  }

  private logDirectorConfigError(directorId: string, account: any, error: string): void {
    this.logFetch({
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
    userReq: UserRequest
  ): void {
    const orchestratorUserReq = createUserRequest(userReq, this.repos);
    const orchestrator = new ConversationOrchestrator(userReq as unknown as ReqLike, context.runId, context.account.id);
    
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
        this.logFetch({
          timestamp: new Date().toISOString(),
          level: 'error',
          provider: context.account.provider,
          accountId: context.account.id,
          event: 'orchestration_error',
          message: 'Failed to start director orchestration',
          directorId: director.id,
          threadId: thread.id,
          detail: error.message
        });
      }
    });
  }
}
