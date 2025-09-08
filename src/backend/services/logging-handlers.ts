import { logOrch, logProviderEvent } from './logging';
import logger from './logger';
import { newId } from '../utils/id';
import type { ReqLike } from '../interfaces';

/**
 * Conversation step logging utilities.
 */
export class ConversationStepLogger {
  constructor(private req?: ReqLike) {}

  logStepStart(threadId: string, stepType: string, emailId: string): void {
    logOrch({
      timestamp: new Date().toISOString(),
      director: 'system',
      agent: 'orchestrator',
      emailId,
      emailSummary: `Step started: ${stepType}`,
      detail: { threadId, stepType, type: 'conversation_step_start' }
    }, this.req);
  }

  logStepComplete(
    threadId: string, 
    stepType: string, 
    durationMs: number, 
    shouldContinue: boolean, 
    toolCallCount: number,
    emailId: string
  ): void {
    logOrch({
      timestamp: new Date().toISOString(),
      director: 'system',
      agent: 'orchestrator',
      emailId,
      emailSummary: `Step complete: ${stepType} (${durationMs}ms, ${toolCallCount} tools)`,
      detail: { threadId, stepType, durationMs, shouldContinue, toolCallCount, type: 'conversation_step_complete' }
    }, this.req);
  }

  logStepError(threadId: string, stepType: string, durationMs: number, error: string, emailId: string): void {
    const isTimeout = error.includes('conversation_step_timeout');
    
    logOrch({
      timestamp: new Date().toISOString(),
      director: 'system',
      agent: 'orchestrator',
      emailId,
      emailSummary: `Step error: ${stepType}`,
      error,
      detail: { threadId, stepType, durationMs, type: isTimeout ? 'conversation_step_timeout' : 'conversation_error' }
    }, this.req);
  }

  logEngineStart(threadId: string, stepType: string, messageCount: number, emailId: string): void {
    logOrch({
      timestamp: new Date().toISOString(),
      director: 'system',
      agent: 'engine',
      emailId,
      emailSummary: `Engine start: ${stepType} (${messageCount} messages)`,
      detail: { threadId, stepType, messageCount, type: 'conversation_engine_start' }
    }, this.req);
  }

  logEngineTimeout(threadId: string, stepType: string, timeoutMs: number, emailId: string): void {
    logOrch({
      timestamp: new Date().toISOString(),
      director: 'system',
      agent: 'engine',
      emailId,
      emailSummary: `Engine timeout: ${stepType} (${timeoutMs}ms)`,
      detail: { threadId, stepType, timeoutMs, type: 'conversation_engine_timeout_triggered' }
    }, this.req);
  }

  logStepCancelled(threadId: string, durationMs: number, emailId: string): void {
    logOrch({
      timestamp: new Date().toISOString(),
      director: 'system',
      agent: 'orchestrator',
      emailId,
      emailSummary: `Step cancelled (${durationMs}ms)`,
      detail: { threadId, durationMs, type: 'conversation_step_cancelled' }
    }, this.req);
  }

  logStepCancelledShutdown(threadId: string, durationMs: number, emailId: string): void {
    logOrch({
      timestamp: new Date().toISOString(),
      director: 'system',
      agent: 'orchestrator',
      emailId,
      emailSummary: `Step cancelled during shutdown (${durationMs}ms)`,
      detail: { threadId, durationMs, type: 'conversation_step_cancelled_shutdown' }
    }, this.req);
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
}

/**
 * Email processing logging utilities.
 */
export class EmailProcessingLogger {
  constructor(private req?: ReqLike) {}

  logFetchStart(): void {
    // Fetch start is global and not tied to a single email. Use standard logging.
    // Avoid orchestration log which requires emailId.
    // This event is covered by FetcherLog elsewhere.
    // Downgrade to info to avoid violating Option A constraints.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    (async () => logger.info('Starting email fetch'))();
  }

  logFetchComplete(emailCount: number, durationMs: number): void {
    // Same rationale as logFetchStart
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    (async () => logger.info(`Fetch complete: ${emailCount} emails in ${durationMs}ms`, { emailCount, durationMs }))();
  }

  logProcessingStart(emailId: string): void {
    logOrch({
      timestamp: new Date().toISOString(),
      director: 'system',
      agent: 'processor',
      emailId,
      emailSummary: `Processing email ${emailId}`,
      detail: { emailId, type: 'processing_start' }
    }, this.req);
  }

  logProcessingComplete(emailId: string, durationMs: number, threadCount: number): void {
    logOrch({
      timestamp: new Date().toISOString(),
      director: 'system',
      agent: 'processor',
      emailId,
      emailSummary: `Processing complete: ${emailId} (${threadCount} threads)`,
      detail: { emailId, durationMs, threadCount, type: 'processing_complete' }
    }, this.req);
  }

  logProcessingError(emailId: string, error: string, durationMs: number): void {
    logOrch({
      timestamp: new Date().toISOString(),
      director: 'system',
      agent: 'processor',
      emailId,
      emailSummary: `Processing error: ${emailId}`,
      error,
      detail: { emailId, durationMs, type: 'processing_error' }
    }, this.req);
  }
}
