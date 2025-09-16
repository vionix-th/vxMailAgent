import { FetcherLogEntry, OrchestrationEvent, ProviderEvent, OrchestrationOutcome, DirectorContext } from '../../shared/types';
import { ReqLike } from '../interfaces';
import { repoGetAll, repoSetAll, requireUserRepo } from '../utils/repo-access';
import type { OrchestrationLogRepository, ProviderEventsRepository } from '../repository/fileRepositories';
import { newId } from '../utils/id';
import logger from './logger';
 

// Minimal helpers: callers must provide valid req and fields; failures surface naturally
function logOrch(entry: OrchestrationEvent, req?: ReqLike): void {
  const repo = requireUserRepo(req as ReqLike, 'orchestrationLog') as unknown as OrchestrationLogRepository;
  void repo.append(entry);
}

function logProviderEvent(event: ProviderEvent, req?: ReqLike): void {
  const repo = requireUserRepo(req as ReqLike, 'providerEvents') as unknown as ProviderEventsRepository;
  void repo.append(event);
}


/**
 * Conversation step logging utilities.
 */
export class ConversationStepLogger {
  constructor(private req: ReqLike | undefined, private runId: string, private accountId: string) {}

  logStepStart(threadId: string, stepType: string, emailId: string, directorId: string): void {
    const context: DirectorContext = {
      runId: this.runId,
      emailId,
      accountId: this.accountId,
      directorId,
      conversationId: threadId,
    };
    const outcome: OrchestrationOutcome = {
      success: true,
      metrics: { threadId, stepType, type: 'conversation_step_start' },
    };
    const entry: OrchestrationEvent = {
      id: newId(),
      timestamp: new Date().toISOString(),
      phase: 'director',
      context,
      outcome,
    };
    logOrch(entry, this.req);
  }

  logStepComplete(
    threadId: string, 
    stepType: string, 
    durationMs: number, 
    shouldContinue: boolean, 
    toolCallCount: number,
    emailId: string,
    directorId: string
  ): void {
    const context: DirectorContext = {
      runId: this.runId,
      emailId,
      accountId: this.accountId,
      directorId,
      conversationId: threadId,
    };
    const outcome: OrchestrationOutcome = {
      success: true,
      metrics: { threadId, stepType, durationMs, shouldContinue, toolCallCount, type: 'conversation_step_complete' },
    };
    const entry: OrchestrationEvent = {
      id: newId(),
      timestamp: new Date().toISOString(),
      phase: 'director',
      context,
      outcome,
    };
    logOrch(entry, this.req);
  }

  logStepError(threadId: string, stepType: string, durationMs: number, error: string, emailId: string, directorId: string): void {
    const isTimeout = error.includes('conversation_step_timeout');
    
    const context: DirectorContext = {
      runId: this.runId,
      emailId,
      accountId: this.accountId,
      directorId,
      conversationId: threadId,
    };
    const outcome: OrchestrationOutcome = {
      success: false,
      error: { message: error, isTimeout },
      metrics: { threadId, stepType, durationMs, error, isTimeout, type: 'conversation_step_error' },
    };
    const entry: OrchestrationEvent = {
      id: newId(),
      timestamp: new Date().toISOString(),
      phase: 'director',
      context,
      outcome,
    };
    logOrch(entry, this.req);
  }

  logEngineStart(threadId: string, stepType: string, messageCount: number, emailId: string, directorId: string): void {
    const context: DirectorContext = {
      runId: this.runId,
      emailId,
      accountId: this.accountId,
      directorId,
      conversationId: threadId,
    };
    const outcome: OrchestrationOutcome = {
      success: true,
      metrics: { threadId, stepType, messageCount, type: 'conversation_engine_start' },
    };
    const entry: OrchestrationEvent = {
      id: newId(),
      timestamp: new Date().toISOString(),
      phase: 'director',
      context,
      outcome,
    };
    logOrch(entry, this.req);
  }

  logEngineTimeout(threadId: string, stepType: string, timeoutMs: number, emailId: string, directorId: string): void {
    const context: DirectorContext = {
      runId: this.runId,
      emailId,
      accountId: this.accountId,
      directorId,
      conversationId: threadId,
    };
    const outcome: OrchestrationOutcome = {
      success: false,
      error: { message: 'Engine timeout', timeoutMs },
      metrics: { threadId, stepType, timeoutMs, type: 'conversation_engine_timeout_triggered' },
    };
    const entry: OrchestrationEvent = {
      id: newId(),
      timestamp: new Date().toISOString(),
      phase: 'director',
      context,
      outcome,
    };
    logOrch(entry, this.req);
  }

  logStepCancelled(threadId: string, durationMs: number, emailId: string, directorId: string): void {
    const context: DirectorContext = {
      runId: this.runId,
      emailId,
      accountId: this.accountId,
      directorId,
      conversationId: threadId,
    };
    const outcome: OrchestrationOutcome = {
      success: false,
      error: { message: 'Step cancelled' },
      metrics: { threadId, durationMs, type: 'conversation_step_cancelled' },
    };
    const entry: OrchestrationEvent = {
      id: newId(),
      timestamp: new Date().toISOString(),
      phase: 'director',
      context,
      outcome,
    };
    logOrch(entry, this.req);
  }

  logStepCancelledShutdown(threadId: string, durationMs: number, emailId: string, directorId: string): void {
    const context: DirectorContext = {
      runId: this.runId,
      emailId,
      accountId: this.accountId,
      directorId,
      conversationId: threadId,
    };
    const outcome: OrchestrationOutcome = {
      success: false,
      error: { message: 'Step cancelled during shutdown' },
      metrics: { threadId, durationMs, type: 'conversation_step_cancelled_shutdown' },
    };
    const entry: OrchestrationEvent = {
      id: newId(),
      timestamp: new Date().toISOString(),
      phase: 'director',
      context,
      outcome,
    };
    logOrch(entry, this.req);
  }
}

/**
 * Provider event logging utilities.
 */
export class ProviderEventLogger {
  constructor(private req?: ReqLike) {}

  logRequest(conversationId: string, payload: any): void {
    logProviderEvent({
      id: newId(),
      conversationId,
      provider: 'openai',
      type: 'request',
      timestamp: new Date().toISOString(),
      payload
    }, this.req);
  }

  logResponse(
    conversationId: string, 
    latencyMs: number, 
    payload: any, 
    usage?: any
  ): void {
    logProviderEvent({
      id: newId(),
      conversationId,
      provider: 'openai',
      type: 'response',
      timestamp: new Date().toISOString(),
      ...(typeof latencyMs === 'number' ? { latencyMs } : {}),
      ...(usage ? {
        usage: {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens
        }
      } : {}),
      payload
    }, this.req);
  }

  logError(conversationId: string, error: string, latencyMs?: number): void {
    logProviderEvent({
      id: newId(),
      conversationId,
      provider: 'openai',
      type: 'error',
      timestamp: new Date().toISOString(),
      ...(typeof latencyMs === 'number' ? { latencyMs } : {}),
      error
    }, this.req);
  }

  logFetcher(entry: Omit<FetcherLogEntry, 'id'>, req?: ReqLike): void {
    const fullEntry: FetcherLogEntry = {
      ...entry,
      id: newId()
    };
    if (req) {
      void repoGetAll(req, 'fetcherLog').then(logs => {
        return repoSetAll(req, 'fetcherLog', [...logs, fullEntry]);
      }).catch(e => logger.error('Failed to log fetcher entry', e));
    }
  }
}

/**
 * Email processing logging utilities.
 */
// EmailProcessingLogger removed as unused
