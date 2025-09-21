import { OrchestrationEvent, ProviderEvent, Trace, Span, OrchestrationOutcome, DirectorContext, FetcherLogEntry } from '../../shared/types';
import { createProviderEvent } from '../../shared/constructors';
import { TRACE_MAX_PAYLOAD, TRACE_MAX_SPANS, TRACE_PERSIST, TRACE_REDACT_FIELDS, TRACE_VERBOSE } from '../config';
import { newId } from '../utils/id';
import { OrchestrationLogRepository, ProviderEventsRepository, TracesRepository } from '../repository/fileRepositories';
import { requireReq, requireUserRepo } from '../utils/repo-access';
import type { ReqLike } from '../interfaces';
// logger import removed; direct repo usage without queue

// Resolve per-user repositories - user context required
function getOrchRepo(req?: ReqLike): OrchestrationLogRepository {
  const ureq = requireReq(req);
  return requireUserRepo(ureq, 'orchestrationLog');
}

function getProviderRepo(req?: ReqLike): ProviderEventsRepository {
  const ureq = requireReq(req);
  return requireUserRepo(ureq, 'providerEvents');
}

function getTracesRepo(req?: ReqLike): TracesRepository {
  const ureq = requireReq(req);
  return requireUserRepo(ureq, 'traces');
}

/** Append an orchestration event to the log. */
export function logOrch(e: OrchestrationEvent, req?: ReqLike): void {
  const repo = getOrchRepo(req);
  void repo.append(e);
}

/** Persist a provider request/response diagnostic entry. */
export function logProviderEvent(e: ProviderEvent, req?: ReqLike): void {
  const repo = getProviderRepo(req);
  void repo.append(e);
}

// Async variants for awaited semantics (canonical write path)
export async function logOrchAsync(e: OrchestrationEvent, req?: ReqLike): Promise<void> {
  const repo = getOrchRepo(req);
  await repo.append(e);
}

export async function logProviderEventAsync(e: ProviderEvent, req?: ReqLike): Promise<void> {
  const repo = getProviderRepo(req);
  await repo.append(e);
}

/** Retrieve all orchestration events. */
export function getOrchestrationLog(req?: ReqLike): Promise<OrchestrationEvent[]> {
  const repo = getOrchRepo(req);
  return repo.getAll();
}

/** Replace the orchestration event log with the provided list. */
export function setOrchestrationLog(next: OrchestrationEvent[], req?: ReqLike): void {
  const repo = getOrchRepo(req);
  void repo.setAll(next);
}

// ---------- Structured tracing ----------

function redact(obj: any): any {
  try {
    if (!obj || typeof obj !== 'object') return obj;
    const json = JSON.stringify(obj);
    let parsed: any = JSON.parse(json);
    const lower = (s: string) => s.toLowerCase();
    const visit = (node: any) => {
      if (!node || typeof node !== 'object') return;
      for (const k of Object.keys(node)) {
        const lk = lower(k);
        if (TRACE_REDACT_FIELDS.includes(lk)) {
          node[k] = '[REDACTED]';
          continue;
        }
        const v = node[k];
        if (v && typeof v === 'object') visit(v);
      }
    };
    visit(parsed);
    // Trim payload size
    let out = JSON.stringify(parsed);
    if (out.length > TRACE_MAX_PAYLOAD) {
      out = out.slice(0, TRACE_MAX_PAYLOAD) + `... [truncated ${out.length - TRACE_MAX_PAYLOAD} bytes]`;
    }
    return JSON.parse(JSON.stringify(out.startsWith('{') || out.startsWith('[') ? JSON.parse(out) : out));
  } catch {
    return '[UNSERIALIZABLE]';
  }
}

/**
 * Create a new trace and persist it if tracing is enabled.
 * Returns the generated trace id.
 */
export function beginTrace(seed: { accountId: string } & Partial<Trace>, req?: ReqLike): string {
  const id = seed?.id || newId();
  const t: Trace = {
    id,
    ...(seed?.emailId ? { emailId: seed.emailId } : {}),
    accountId: seed.accountId,
    ...(seed?.provider ? { provider: seed.provider } : {}),
    createdAt: new Date().toISOString(),
    status: 'ok',
    spans: [],
  } as Trace;
  const repo = getTracesRepo(req);
  if (TRACE_PERSIST && repo) void repo.append(t);
  return id;
}

/** Update a trace when it completes, optionally recording status or error. */
export function endTrace(id: string, status?: 'ok' | 'error', error?: string, req?: ReqLike): void {
  const repo = getTracesRepo(req);
  if (!TRACE_PERSIST || !repo) return;
  void repo.update(id, (t) => {
    Object.assign(t, { endedAt: new Date().toISOString() });
    if (status) t.status = status;
    if (error) t.error = error;
  });
}

/**
 * Start a new span within an existing trace. Returns the span id.
 */
export function beginSpan(traceId: string, span: Omit<Span, 'id' | 'start'> & { id?: string }, req?: ReqLike): string {
  const repo = getTracesRepo(req);
  if (!TRACE_PERSIST || !repo) return '';
  const sid = span.id || newId();
  const now = new Date().toISOString();
  void repo.update(traceId, (t) => {
    if (t.spans.length >= TRACE_MAX_SPANS) return;
    const s: Span = {
      id: sid,
      type: span.type,
      status: 'ok',
      start: now,
      ...(span.parentId ? { parentId: span.parentId } : {}),
      ...(span.name ? { name: span.name } : {}),
      ...(span.emailId ? { emailId: span.emailId } : {}),
      ...(span.provider ? { provider: span.provider } : {}),
      ...(span.directorId ? { directorId: span.directorId } : {}),
      ...(span.agentId ? { agentId: span.agentId } : {}),
      ...(span.toolCallId ? { toolCallId: span.toolCallId } : {}),
      ...(TRACE_VERBOSE && span.request !== undefined ? { request: redact(span.request) } : {}),
      ...(span.annotations ? { annotations: span.annotations } : {}),
    } as Span;
    t.spans.push(s);
  });
  return sid;
}

/**
 * Finalize a span and optionally annotate its status, error, or response.
 */
export function endSpan(traceId: string, spanId: string, input?: { status?: 'ok' | 'error'; error?: string; response?: any }, req?: ReqLike): void {
  const repo = getTracesRepo(req);
  if (!TRACE_PERSIST || !repo) return;
  void repo.update(traceId, (t) => {
    const s = t.spans.find(x => x.id === spanId);
    if (!s) return;
    const end = new Date().toISOString();
    s.end = end;
    const startMs = Date.parse(s.start);
    const endMs = Date.parse(end);
    if (!isNaN(startMs) && !isNaN(endMs)) s.durationMs = Math.max(0, endMs - startMs);
    if (input?.status) s.status = input.status;
    if (input?.error) s.error = input.error;
    if (TRACE_VERBOSE && input?.response !== undefined) s.response = redact(input.response);
  });
}

/** Merge additional annotations into an existing span. */
export function annotateSpan(traceId: string, spanId: string, annotations: Record<string, any>, req?: ReqLike): void {
  const repo = getTracesRepo(req);
  if (!TRACE_PERSIST || !repo) return;
  void repo.update(traceId, (t) => {
    const s = t.spans.find(x => x.id === spanId);
    if (!s) return;
    s.annotations = Object.assign({}, s.annotations || {}, annotations);
  });
}

/** Retrieve all traces available to the request. */
export function getTraces(req?: ReqLike): Trace[] | Promise<Trace[]> {
  const repo = getTracesRepo(req);
  return repo ? repo.getAll() : [];
}

// ---------- Wrapper classes (folded here for a single logging entry point) ----------

/**
 * Conversation step logging utilities with awaited persistence.
 */
export class ConversationStepLogger {
  constructor(private req: ReqLike | undefined, private runId: string, private accountId: string) {}

  private async log(entry: OrchestrationEvent): Promise<void> {
    await logOrchAsync(entry, this.req);
  }

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
    await this.log({ id: newId(), timestamp: new Date().toISOString(), phase: 'director', context, outcome });
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
    await this.log({ id: newId(), timestamp: new Date().toISOString(), phase: 'director', context, outcome });
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
    await this.log({ id: newId(), timestamp: new Date().toISOString(), phase: 'director', context, outcome });
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
    await this.log({ id: newId(), timestamp: new Date().toISOString(), phase: 'director', context, outcome });
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
    await this.log({ id: newId(), timestamp: new Date().toISOString(), phase: 'director', context, outcome });
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
    await this.log({ id: newId(), timestamp: new Date().toISOString(), phase: 'director', context, outcome });
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
    await this.log({ id: newId(), timestamp: new Date().toISOString(), phase: 'director', context, outcome });
  }
}

/**
 * Provider event logging utilities with awaited persistence.
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
    await logProviderEventAsync(event, this.req);
  }

  async logResponse(conversationId: string, latencyMs: number, payload: any, usage?: any): Promise<void> {
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
    await logProviderEventAsync(event, this.req);
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
    await logProviderEventAsync(event, this.req);
  }

  logFetcher(entry: Omit<FetcherLogEntry, 'id'>, req?: ReqLike): void {
    const fullEntry: FetcherLogEntry = { ...entry, id: newId() } as FetcherLogEntry;
    if (req) {
      void requireUserRepo(req as ReqLike, 'fetcherLog').getAll().then((logs: any[]) => {
        return requireUserRepo(req as ReqLike, 'fetcherLog').setAll([...(Array.isArray(logs) ? logs : []), fullEntry]);
      }).catch(() => {
        // Swallow to avoid throwing from background log; caller can log via logger if needed.
      });
    }
  }
}
