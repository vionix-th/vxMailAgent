import { OrchestrationDiagnosticEntry, ProviderEvent, Trace, Span } from '../../shared/types';
import { TRACE_MAX_PAYLOAD, TRACE_MAX_SPANS, TRACE_PERSIST, TRACE_REDACT_FIELDS, TRACE_VERBOSE } from '../config';
import { newId } from '../utils/id';
import { OrchestrationLogRepository, ProviderEventsRepository, TracesRepository } from '../repository/fileRepositories';
import { ReqLike, requireReq, requireUserRepo } from '../utils/repo-access';

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

/** Append an orchestration diagnostic entry to the log. */
export function logOrch(e: OrchestrationDiagnosticEntry, req?: ReqLike): void {
  const repo = getOrchRepo(req);
  // best-effort persistence; do not block callers
  repo.getAll().then((list) => { list.push(e); return repo.setAll(list); }).catch(() => {});
}

/** Persist a provider request/response diagnostic entry. */
export function logProviderEvent(e: ProviderEvent, req?: ReqLike): void {
  const repo = getProviderRepo(req);
  // best-effort persistence
  repo.append(e).catch(() => {});
}

/** Retrieve all orchestration diagnostic entries. */
export function getOrchestrationLog(req?: ReqLike): Promise<OrchestrationDiagnosticEntry[]> {
  const repo = getOrchRepo(req);
  return repo.getAll();
}

/** Replace the orchestration diagnostic log with the provided list. */
export function setOrchestrationLog(next: OrchestrationDiagnosticEntry[], req?: ReqLike): void {
  const repo = getOrchRepo(req);
  // best-effort persistence
  repo.setAll(next).catch(() => {});
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
export function beginTrace(seed?: Partial<Trace>, req?: ReqLike): string {
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
  if (TRACE_PERSIST && repo) repo.append(t).catch(() => {});
  return id;
}

/** Update a trace when it completes, optionally recording status or error. */
export function endTrace(id: string, status?: 'ok' | 'error', error?: string, req?: ReqLike): void {
  const repo = getTracesRepo(req);
  if (!TRACE_PERSIST || !repo) return;
  repo.update(id, (t) => {
    t.endedAt = new Date().toISOString();
    if (status) t.status = status;
    if (error) t.error = error;
  }).catch(() => {});
}

/**
 * Start a new span within an existing trace. Returns the span id.
 */
export function beginSpan(traceId: string, span: Omit<Span, 'id' | 'start'> & { id?: string }, req?: ReqLike): string {
  const repo = getTracesRepo(req);
  if (!TRACE_PERSIST || !repo) return '';
  const sid = span.id || newId();
  const now = new Date().toISOString();
  repo.update(traceId, (t) => {
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
  }).catch(() => {});
  return sid;
}

/**
 * Finalize a span and optionally annotate its status, error, or response.
 */
export function endSpan(traceId: string, spanId: string, input?: { status?: 'ok' | 'error'; error?: string; response?: any }, req?: ReqLike): void {
  const repo = getTracesRepo(req);
  if (!TRACE_PERSIST || !repo) return;
  repo.update(traceId, (t) => {
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
  }).catch(() => {});
}

/** Merge additional annotations into an existing span. */
export function annotateSpan(traceId: string, spanId: string, annotations: Record<string, any>, req?: ReqLike): void {
  const repo = getTracesRepo(req);
  if (!TRACE_PERSIST || !repo) return;
  repo.update(traceId, (t) => {
    const s = t.spans.find(x => x.id === spanId);
    if (!s) return;
    s.annotations = Object.assign({}, s.annotations || {}, annotations);
  }).catch(() => {});
}

/** Retrieve all traces available to the request. */
export function getTraces(req?: ReqLike): Trace[] | Promise<Trace[]> {
  const repo = getTracesRepo(req);
  return repo ? repo.getAll() : [];
}
