import { ConversationThread, Agent, Director, Filter, Prompt } from '../../shared/types';
import { LiveRepos } from '../liveRepos';
import { UserRequest } from '../middleware/user-context';
import { evaluateFilters, selectDirectorTriggers } from './orchestration';
import { ConversationOrchestrator } from './conversation-orchestrator';
import { newId } from '../utils/id';
import { beginSpan, endSpan, logOrch, logProviderEvent } from './logging';

export interface EmailEnvelope {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  bodyPlain?: string;
  bodyHtml?: string;
  attachments: any[];
}

export interface EmailProcessingContext {
  envelope: EmailEnvelope;
  account: any;
  traceId: string;
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

    const filterEvaluations = evaluateFilters(filters, {
      from: envelope.from,
      subject: envelope.subject,
      bodyPlain: envelope.bodyPlain,
      bodyHtml: envelope.bodyHtml,
      snippet: envelope.snippet,
      date: envelope.date
    });

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
    const { prompts, apiConfigs } = context;
    
    const directorPrompt = prompts.find(p => p.id === director.promptId);
    const directorApi = apiConfigs.find(c => c.id === director.apiConfigId);

    if (!directorApi || !directorPrompt) {
      this.logFetch({
        timestamp: new Date().toISOString(),
        level: 'error',
        provider: context.account.provider,
        accountId: context.account.id,
        event: 'director_config_missing',
        message: 'Missing director apiConfig or prompt',
        directorId: director.id
      });
      return null;
    }

    const dirThreadId = newId();
    const nowIso = new Date().toISOString();

    const dirThread: ConversationThread = {
      id: dirThreadId,
      kind: 'director',
      directorId: director.id,
      traceId,
      email: envelope as any,
      promptId: director.promptId || '',
      apiConfigId: director.apiConfigId,
      startedAt: nowIso,
      status: 'ongoing',
      lastActiveAt: nowIso,
      messages: directorPrompt.messages ? [...directorPrompt.messages] : [],
      errors: [],
      workspaceItems: [],
      finalized: false,
    } as ConversationThread;

    // Add email context message
    const emailContextMsg = {
      role: 'user',
      content: `Email context\nsubject: ${envelope.subject}\nfrom: ${envelope.from}\ndate: ${envelope.date}\nsnippet: ${envelope.snippet}`,
      context: { traceId }
    };

    dirThread.messages.push({
      role: 'user',
      content: emailContextMsg.content
    });

    // Persist the new thread
    const conversations = await this.repos.getConversations(userReq);
    const updatedConversations = [...conversations, dirThread];
    await this.repos.setConversations(userReq, updatedConversations);

    const sConvCreate = beginSpan(traceId, {
      type: 'conversation_update',
      name: 'create_director_thread',
      emailId: envelope.id,
      directorId: director.id
    }, userReq);

    endSpan(traceId, sConvCreate, { status: 'ok' }, userReq);

    this.logFetch({
      timestamp: new Date().toISOString(),
      level: 'info',
      provider: context.account.provider,
      accountId: context.account.id,
      event: 'director_thread_created',
      message: 'Created director conversation thread',
      directorId: director.id,
      threadId: dirThreadId
    });

    // Trigger orchestration for the newly created director thread
    const orchestrator = new ConversationOrchestrator(
      this.repos,
      logProviderEvent,
      logOrch,
      userReq
    );
    
    // Start orchestration asynchronously - don't block email processing
    setImmediate(async () => {
      try {
        await orchestrator.runConversationStep({
          thread: dirThread,
          traceId,
          agents: context.agents,
          apiConfigs: context.apiConfigs,
          prompts: context.prompts
        }, userReq);
      } catch (error: any) {
        this.logFetch({
          timestamp: new Date().toISOString(),
          level: 'error',
          provider: context.account.provider,
          accountId: context.account.id,
          event: 'orchestration_error',
          message: 'Failed to start director orchestration',
          directorId: director.id,
          threadId: dirThreadId,
          detail: error.message
        });
      }
    });

    return dirThreadId;
  }
}
