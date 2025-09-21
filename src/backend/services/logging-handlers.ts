import { FetcherLogEntry, OrchestrationEvent, ProviderEvent, OrchestrationOutcome, DirectorContext } from '../../shared/types';
import { createProviderEvent } from '../../shared/constructors';
import { ReqLike } from '../interfaces';
import { repoGetAll, repoSetAll, requireUserRepo } from '../utils/repo-access';
import type { OrchestrationLogRepository, ProviderEventsRepository } from '../repository/fileRepositories';
import { newId } from '../utils/id';
import logger from './logger';
 

// Helpers now await repository writes so failures propagate to callers
async function logOrch(entry: OrchestrationEvent, req?: ReqLike): Promise<void> {
  const repo = requireUserRepo(req as ReqLike, 'orchestrationLog') as unknown as OrchestrationLogRepository;
  await repo.append(entry);
}

async function logProviderEvent(event: ProviderEvent, req?: ReqLike): Promise<void> {
  const repo = requireUserRepo(req as ReqLike, 'providerEvents') as unknown as ProviderEventsRepository;
  await repo.append(event);
}


/**
 * Conversation step logging utilities.
 */
export class ConversationStepLogger {
  constructor(private req: ReqLike | undefined, private runId: string, private accountId: string) {}

  async logStepStart(threadId: string, stepType: string, emailId: string, directorId: string): Promise<void> {
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
    await logOrch(entry, this.req);
  }

  async logStepComplete(
    threadId: string, 
    stepType: string, 
    durationMs: number, 
    shouldContinue: boolean, 
    toolCallCount: number,
    emailId: string,
    directorId: string
  ): Promise<void> {
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
    await logOrch(entry, this.req);
  }

  async logStepError(threadId: string, stepType: string, durationMs: number, error: string, emailId: string, directorId: string): Promise<void> {
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
    await logOrch(entry, this.req);
  }

  async logEngineStart(threadId: string, stepType: string, messageCount: number, emailId: string, directorId: string): Promise<void> {
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
    await logOrch(entry, this.req);
  }

  async logEngineTimeout(threadId: string, stepType: string, timeoutMs: number, emailId: string, directorId: string): Promise<void> {
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
    await logOrch(entry, this.req);
  }

  async logStepCancelled(threadId: string, durationMs: number, emailId: string, directorId: string): Promise<void> {
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
    await logOrch(entry, this.req);
  }

  async logStepCancelledShutdown(threadId: string, durationMs: number, emailId: string, directorId: string): Promise<void> {
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
    await logOrch(entry, this.req);
  }
}

/**
 * Provider event logging utilities.
 */
export class ProviderEventLogger {
  constructor(private req?: ReqLike) {}

  async logRequest(conversationId: string, payload: any): Promise<void> {
    const event = createProviderEvent({
      id: newId(),
      conversationId,
      provider: 'openai',
      type: 'request',
      timestamp: new Date().toISOString(),
      payload
    });
    await logProviderEvent(event, this.req);
  }

  async logResponse(
    conversationId: string, 
    latencyMs: number, 
    payload: any, 
    usage?: any
  ): Promise<void> {
    const event = createProviderEvent({
      id: newId(),
      conversationId,
      provider: 'openai',
      type: 'response',
      timestamp: new Date().toISOString(),
      latencyMs,
      usage: usage ? {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens
      } : undefined,
      payload
    });
    await logProviderEvent(event, this.req);
  }

  async logError(conversationId: string, error: string, latencyMs?: number): Promise<void> {
    const event = createProviderEvent({
      id: newId(),
      conversationId,
      provider: 'openai',
      type: 'error',
      timestamp: new Date().toISOString(),
      latencyMs,
      error
    });
    await logProviderEvent(event, this.req);
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
