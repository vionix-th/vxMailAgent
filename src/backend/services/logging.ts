import { OrchestrationDiagnosticEntry, ProviderEvent, Trace, Span } from '../../shared/types';
import { TRACE_MAX_PAYLOAD, TRACE_MAX_SPANS, TRACE_PERSIST, TRACE_REDACT_FIELDS, TRACE_VERBOSE } from '../config';
import { newId } from '../utils/id';
import { OrchestrationLogRepository, ProviderEventsRepository, TracesRepository } from '../repository/fileRepositories';
import { UserRequest } from '../middleware/user-context';
import { requireReq, requireUserRepo } from '../utils/repo-access';

// Resolve per-user repositories - user context required
function getOrchRepo(req?: UserRequest): OrchestrationLogRepository {
  const ureq = requireReq(req);
  return requireUserRepo(ureq, 'orchestrationLog');
}

function getProviderRepo(req?: UserRequest): ProviderEventsRepository {
  const ureq = requireReq(req);
  return requireUserRepo(ureq, 'providerEvents');
}

function getTracesRepo(req?: UserRequest): TracesRepository {
  const ureq = requireReq(req);
  return requireUserRepo(ureq, 'traces');
}

/** Append an orchestration diagnostic entry to the log. */
export async function logOrch(e: OrchestrationDiagnosticEntry, req?: UserRequest): Promise<void> {
  const repo = getOrchRepo(req);
  const list = await repo.getAll();
  list.push(e);
  await repo.setAll(list);
}

/** Persist a provider request/response diagnostic entry. */
export async function logProviderEvent(e: ProviderEvent, req?: UserRequest): Promise<void> {
  const repo = getProviderRepo(req);
  await repo.append(e);
}

/** Retrieve all orchestration diagnostic entries. */
export async function getOrchestrationLog(req?: UserRequest): Promise<OrchestrationDiagnosticEntry[]> {
  const repo = getOrchRepo(req);
  return repo.getAll();
}

/** Replace the orchestration diagnostic log with the provided list. */
export async function setOrchestrationLog(next: OrchestrationDiagnosticEntry[], req?: UserRequest): Promise<void> {
  const repo = getOrchRepo(req);
  await repo.setAll(next);
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
export async function beginTrace(seed?: Partial<Trace>, req?: UserRequest): Promise<string> {
  const id = seed?.id || newId();
  const t: Trace = {
    id,
    emailId: seed?.emailId,
    accountId: seed?.accountId,
    provider: seed?.provider,
    createdAt: new Date().toISOString(),
    status: 'ok',
    spans: [],
  };
  const repo = getTracesRepo(req);
  if (TRACE_PERSIST && repo) await repo.append(t);
  return id;
}

/** Update a trace when it completes, optionally recording status or error. */
export async function endTrace(id: string, status?: 'ok' | 'error', error?: string, req?: UserRequest): Promise<void> {
  const repo = getTracesRepo(req);
  if (!TRACE_PERSIST || !repo) return;
  await repo.update(id, (t) => {
    t.endedAt = new Date().toISOString();
    if (status) t.status = status;
    if (error) t.error = error;
  });
}

/**
 * Start a new span within an existing trace. Returns the span id.
 */
export async function beginSpan(traceId: string, span: Omit<Span, 'id' | 'start'> & { id?: string }, req?: UserRequest): Promise<string> {
  const repo = getTracesRepo(req);
  if (!TRACE_PERSIST || !repo) return '';
  const sid = span.id || newId();
  const now = new Date().toISOString();
  await repo.update(traceId, (t) => {
    if (t.spans.length >= TRACE_MAX_SPANS) return;
    const s: Span = {
      id: sid,
      parentId: span.parentId,
      type: span.type,
      name: span.name,
      status: 'ok',
      start: now,
      emailId: span.emailId,
      provider: span.provider,
      directorId: span.directorId,
      agentId: span.agentId,
      toolCallId: span.toolCallId,
      request: TRACE_VERBOSE ? redact(span.request) : undefined,
      response: undefined,
      annotations: span.annotations,
    };
    t.spans.push(s);
  });
  return sid;
}

/**
 * Finalize a span and optionally annotate its status, error, or response.
 */
export async function endSpan(traceId: string, spanId: string, input?: { status?: 'ok' | 'error'; error?: string; response?: any }, req?: UserRequest): Promise<void> {
  const repo = getTracesRepo(req);
  if (!TRACE_PERSIST || !repo) return;
  await repo.update(traceId, (t) => {
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
export async function annotateSpan(traceId: string, spanId: string, annotations: Record<string, any>, req?: UserRequest): Promise<void> {
  const repo = getTracesRepo(req);
  if (!TRACE_PERSIST || !repo) return;
  await repo.update(traceId, (t) => {
    const s = t.spans.find(x => x.id === spanId);
    if (!s) return;
    s.annotations = Object.assign({}, s.annotations || {}, annotations);
  });
}

/** Retrieve all traces available to the request. */
export async function getTraces(req?: UserRequest): Promise<Trace[]> {
  const repo = getTracesRepo(req);
  return repo ? repo.getAll() : [];
}
