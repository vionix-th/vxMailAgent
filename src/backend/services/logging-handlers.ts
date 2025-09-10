import { FetcherLogEntry, OrchestrationEvent, ProviderEvent, OrchestrationContext, OrchestrationOutcome } from '../../shared/types';
import { ReqLike } from '../interfaces';
import { repoGetAll, repoSetAll } from '../utils/repo-access';
import { newId } from '../utils/id';
import logger from './logger';

// Helper functions for logging
function logOrch(entry: OrchestrationEvent, req?: ReqLike): void {
  // Implementation will append to orchestration log
  if (req) {
    repoGetAll(req, 'orchestrationLog').then(logs => {
      repoSetAll(req, 'orchestrationLog', [...logs, entry]);
    }).catch(e => logger.error('Failed to log orchestration entry', e));
  }
}

function logProviderEvent(event: ProviderEvent, req?: ReqLike): void {
  // Implementation will append to provider events
  if (req) {
    repoGetAll(req, 'providerEvents').then(events => {
      repoSetAll(req, 'providerEvents', [...events, event]);
    }).catch(e => logger.error('Failed to log provider event', e));
  }
}

export function logOrchestrationStart(directorId: string, emailId: string, req?: ReqLike): void {
  const context: OrchestrationContext = {
    fetchCycleId: '',
    emailId,
    directorId,
  };
  const outcome: OrchestrationOutcome = {
    success: true,
    metrics: { action: 'start' },
  };
  const entry: OrchestrationEvent = {
    id: newId(),
    timestamp: new Date().toISOString(),
    phase: 'director',
    context,
    outcome,
  };
  logOrch(entry, req);
}

export function logOrchestrationSuccess(directorId: string, emailId: string, result: any, req?: ReqLike): void {
  const context: OrchestrationContext = {
    fetchCycleId: '',
    emailId,
    directorId,
  };
  const outcome: OrchestrationOutcome = {
    success: true,
    result,
    metrics: { action: 'success' },
  };
  const entry: OrchestrationEvent = {
    id: newId(),
    timestamp: new Date().toISOString(),
    phase: 'director',
    context,
    outcome,
  };
  logOrch(entry, req);
}

export function logOrchestrationError(directorId: string, emailId: string, error: any, req?: ReqLike): void {
  const context: OrchestrationContext = {
    fetchCycleId: '',
    emailId,
    directorId,
  };
  const outcome: OrchestrationOutcome = {
    success: false,
    error,
    metrics: { action: 'error' },
  };
  const entry: OrchestrationEvent = {
    id: newId(),
    timestamp: new Date().toISOString(),
    phase: 'director',
    context,
    outcome,
  };
  logOrch(entry, req);
}

export function logAgentStart(agentId: string, emailId: string, req?: ReqLike): void {
  const context: OrchestrationContext = {
    fetchCycleId: '',
    emailId,
    directorId: '',
    agentId,
  };
  const outcome: OrchestrationOutcome = {
    success: true,
    metrics: { action: 'start' },
  };
  const entry: OrchestrationEvent = {
    id: newId(),
    timestamp: new Date().toISOString(),
    phase: 'agent',
    context,
    outcome,
  };
  logOrch(entry, req);
}

export function logAgentSuccess(agentId: string, emailId: string, result: any, req?: ReqLike): void {
  const context: OrchestrationContext = {
    fetchCycleId: '',
    emailId,
    directorId: '',
    agentId,
  };
  const outcome: OrchestrationOutcome = {
    success: true,
    result,
    metrics: { action: 'success' },
  };
  const entry: OrchestrationEvent = {
    id: newId(),
    timestamp: new Date().toISOString(),
    phase: 'agent',
    context,
    outcome,
  };
  logOrch(entry, req);
}

export function logAgentError(agentId: string, emailId: string, error: any, req?: ReqLike): void {
  const context: OrchestrationContext = {
    fetchCycleId: '',
    emailId,
    directorId: '',
    agentId,
  };
  const outcome: OrchestrationOutcome = {
    success: false,
    error,
    metrics: { action: 'error' },
  };
  const entry: OrchestrationEvent = {
    id: newId(),
    timestamp: new Date().toISOString(),
    phase: 'agent',
    context,
    outcome,
  };
  logOrch(entry, req);
}

export function logToolStart(tool: string, emailId: string, req?: ReqLike): void {
  const context: OrchestrationContext = {
    fetchCycleId: '',
    emailId,
    directorId: '',
  };
  const outcome: OrchestrationOutcome = {
    success: true,
    metrics: { action: 'start', tool },
  };
  const entry: OrchestrationEvent = {
    id: newId(),
    timestamp: new Date().toISOString(),
    phase: 'tool',
    context,
    outcome,
  };
  logOrch(entry, req);
}

export function logToolSuccess(tool: string, emailId: string, result: any, req?: ReqLike): void {
  const context: OrchestrationContext = {
    fetchCycleId: '',
    emailId,
    directorId: '',
  };
  const outcome: OrchestrationOutcome = {
    success: true,
    result,
    metrics: { action: 'success', tool },
  };
  const entry: OrchestrationEvent = {
    id: newId(),
    timestamp: new Date().toISOString(),
    phase: 'tool',
    context,
    outcome,
  };
  logOrch(entry, req);
}

export function logToolError(tool: string, emailId: string, error: any, req?: ReqLike): void {
  const context: OrchestrationContext = {
    fetchCycleId: '',
    emailId,
    directorId: '',
  };
  const outcome: OrchestrationOutcome = {
    success: false,
    error,
    metrics: { action: 'error', tool },
  };
  const entry: OrchestrationEvent = {
    id: newId(),
    timestamp: new Date().toISOString(),
    phase: 'tool',
    context,
    outcome,
  };
  logOrch(entry, req);
}

/**
 * Conversation step logging utilities.
 */
export class ConversationStepLogger {
  constructor(private req?: ReqLike, private fetchCycleId?: string) {}

  logStepStart(threadId: string, stepType: string, emailId: string, directorId?: string): void {
    const context: OrchestrationContext = {
      fetchCycleId: this.fetchCycleId || 'unknown',
      emailId,
      directorId: directorId || 'system',
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
    directorId?: string
  ): void {
    const context: OrchestrationContext = {
      fetchCycleId: this.fetchCycleId || 'unknown',
      emailId,
      directorId: directorId || 'system',
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

  logStepError(threadId: string, stepType: string, durationMs: number, error: string, emailId: string, directorId?: string): void {
    const isTimeout = error.includes('conversation_step_timeout');
    
    const context: OrchestrationContext = {
      fetchCycleId: this.fetchCycleId || 'unknown',
      emailId,
      directorId: directorId || 'system',
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

  logEngineStart(threadId: string, stepType: string, messageCount: number, emailId: string, directorId?: string): void {
    const context: OrchestrationContext = {
      fetchCycleId: this.fetchCycleId || 'unknown',
      emailId,
      directorId: directorId || 'system',
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

  logEngineTimeout(threadId: string, stepType: string, timeoutMs: number, emailId: string, directorId?: string): void {
    const context: OrchestrationContext = {
      fetchCycleId: this.fetchCycleId || 'unknown',
      emailId,
      directorId: directorId || 'system',
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

  logStepCancelled(threadId: string, durationMs: number, emailId: string, directorId?: string): void {
    const context: OrchestrationContext = {
      fetchCycleId: this.fetchCycleId || 'unknown',
      emailId,
      directorId: directorId || 'system',
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

  logStepCancelledShutdown(threadId: string, durationMs: number, emailId: string, directorId?: string): void {
    const context: OrchestrationContext = {
      fetchCycleId: this.fetchCycleId || 'unknown',
      emailId,
      directorId: directorId || 'system',
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
      repoGetAll(req, 'fetcherLog').then(logs => {
        repoSetAll(req, 'fetcherLog', [...logs, fullEntry]);
      }).catch(e => logger.error('Failed to log fetcher entry', e));
    }
  }
}

/**
 * Email processing logging utilities.
 */
export class EmailProcessingLogger {
  constructor(private req?: ReqLike, private fetchCycleId?: string) {}

  logFetchStart(): void {
    // Fetch start is global and not tied to a single email. Use standard logging.
    // Avoid orchestration log which requires emailId.
    // This event is covered by FetcherLog elsewhere.
    // Downgrade to info to avoid violating Option A constraints.
    (async () => logger.info('Starting email fetch'))();
  }

  logFetchComplete(emailCount: number, durationMs: number): void {
    // Same rationale as logFetchStart
    (async () => logger.info(`Fetch complete: ${emailCount} emails in ${durationMs}ms`, { emailCount, durationMs }))();
  }

  logProcessingStart(emailId: string): void {
    const context: OrchestrationContext = {
      fetchCycleId: this.fetchCycleId || 'unknown',
      emailId,
      directorId: 'system',
      agentId: 'processor',
    };
    const outcome: OrchestrationOutcome = {
      success: true,
      metrics: { emailId, type: 'processing_start' },
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

  logProcessingComplete(emailId: string, durationMs: number, threadCount: number): void {
    const context: OrchestrationContext = {
      fetchCycleId: this.fetchCycleId || 'unknown',
      emailId,
      directorId: 'system',
      agentId: 'processor',
    };
    const outcome: OrchestrationOutcome = {
      success: true,
      metrics: { emailId, durationMs, threadCount, type: 'processing_complete' },
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

  logProcessingError(emailId: string, error: string, durationMs: number): void {
    const context: OrchestrationContext = {
      fetchCycleId: this.fetchCycleId || 'unknown',
      emailId,
      directorId: 'system',
      agentId: 'processor',
    };
    const outcome: OrchestrationOutcome = {
      success: false,
      error: { message: error },
      metrics: { emailId, durationMs, type: 'processing_error' },
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
