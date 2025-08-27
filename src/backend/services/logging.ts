import { OrchestrationDiagnosticEntry, ProviderEvent, Trace, Span } from '../../shared/types';
import { TRACE_MAX_PAYLOAD, TRACE_MAX_SPANS, TRACE_PERSIST, TRACE_REDACT_FIELDS, TRACE_VERBOSE } from '../config';
import { newId } from '../utils/id';
import { Repository } from '../repository/core';
import { ProviderEventsRepository, TracesRepository } from '../repository/fileRepositories';
import { UserRequest, hasUserContext, getUserContext } from '../middleware/user-context';

// Global repositories for fallback
let globalOrchRepo: Repository<OrchestrationDiagnosticEntry> | null = null;
let globalProviderRepo: ProviderEventsRepository | null = null;
let globalTracesRepo: TracesRepository | null = null;

export function initLogging(input: {
  orchRepo: Repository<OrchestrationDiagnosticEntry>;
  providerRepo: ProviderEventsRepository;
  tracesRepo: TracesRepository;
}) {
  globalOrchRepo = input.orchRepo;
  globalProviderRepo = input.providerRepo;
  globalTracesRepo = input.tracesRepo;
}

// Helper functions to get per-user or global repositories
function getOrchRepo(req?: UserRequest): Repository<OrchestrationDiagnosticEntry> | null {
  if (req && hasUserContext(req)) {
    return getUserContext(req).repos.orchestrationLog;
  }
  return globalOrchRepo;
}

function getProviderRepo(req?: UserRequest): ProviderEventsRepository | null {
  if (req && hasUserContext(req)) {
    return getUserContext(req).repos.providerEvents;
  }
  return globalProviderRepo;
}

function getTracesRepo(req?: UserRequest): TracesRepository | null {
  if (req && hasUserContext(req)) {
    return getUserContext(req).repos.traces;
  }
  return globalTracesRepo;
}

export function logOrch(e: OrchestrationDiagnosticEntry, req?: UserRequest) {
  const repo = getOrchRepo(req);
  if (!repo) return;
  const list = repo.getAll();
  list.push(e);
  repo.setAll(list);
}

export function logProviderEvent(e: ProviderEvent, req?: UserRequest) {
  const repo = getProviderRepo(req);
  if (!repo) return;
  repo.append(e);
}

export function getOrchestrationLog(req?: UserRequest) {
  const repo = getOrchRepo(req);
  return repo ? repo.getAll() : [];
}

export function setOrchestrationLog(next: OrchestrationDiagnosticEntry[], req?: UserRequest) {
  const repo = getOrchRepo(req);
  if (!repo) return;
  repo.setAll(next);
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

export function beginTrace(seed?: Partial<Trace>, req?: UserRequest): string {
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
  if (TRACE_PERSIST && repo) repo.append(t);
  return id;
}

export function endTrace(id: string, status?: 'ok' | 'error', error?: string, req?: UserRequest) {
  const repo = getTracesRepo(req);
  if (!TRACE_PERSIST || !repo) return;
  repo.update(id, (t) => {
    t.endedAt = new Date().toISOString();
    if (status) t.status = status;
    if (error) t.error = error;
  });
}

export function beginSpan(traceId: string, span: Omit<Span, 'id' | 'start'> & { id?: string }, req?: UserRequest): string {
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
  });
  return sid;
}

export function endSpan(traceId: string, spanId: string, input?: { status?: 'ok' | 'error'; error?: string; response?: any }, req?: UserRequest) {
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
  });
}

export function annotateSpan(traceId: string, spanId: string, annotations: Record<string, any>, req?: UserRequest) {
  const repo = getTracesRepo(req);
  if (!TRACE_PERSIST || !repo) return;
  repo.update(traceId, (t) => {
    const s = t.spans.find(x => x.id === spanId);
    if (!s) return;
    s.annotations = Object.assign({}, s.annotations || {}, annotations);
  });
}

export function getTraces(req?: UserRequest) {
  const repo = getTracesRepo(req);
  return repo ? repo.getAll() : [];
}
