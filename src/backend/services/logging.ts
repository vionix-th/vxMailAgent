import { OrchestrationDiagnosticEntry, ProviderEvent, Trace, Span } from '../../shared/types';
import { TRACE_MAX_PAYLOAD, TRACE_MAX_SPANS, TRACE_PERSIST, TRACE_REDACT_FIELDS, TRACE_VERBOSE } from '../config';
import { newId } from '../utils/id';
import { Repository } from '../repository/core';
import { ProviderEventsRepository, TracesRepository } from '../repository/fileRepositories';

let orchRepo: Repository<OrchestrationDiagnosticEntry> | null = null;
let providerRepo: ProviderEventsRepository | null = null;
let tracesRepo: TracesRepository | null = null;

export function initLogging(input: {
  orchRepo: Repository<OrchestrationDiagnosticEntry>;
  providerRepo: ProviderEventsRepository;
  tracesRepo: TracesRepository;
}) {
  orchRepo = input.orchRepo;
  providerRepo = input.providerRepo;
  tracesRepo = input.tracesRepo;
}

export function logOrch(e: OrchestrationDiagnosticEntry) {
  if (!orchRepo) return;
  const list = orchRepo.getAll();
  list.push(e);
  orchRepo.setAll(list);
}

export function logProviderEvent(e: ProviderEvent) {
  if (!providerRepo) return;
  providerRepo.append(e);
}

export function getOrchestrationLog() {
  return orchRepo ? orchRepo.getAll() : [];
}

export function setOrchestrationLog(next: OrchestrationDiagnosticEntry[]) {
  if (!orchRepo) return;
  orchRepo.setAll(next);
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

export function beginTrace(seed?: Partial<Trace>): string {
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
  if (TRACE_PERSIST && tracesRepo) tracesRepo.append(t);
  return id;
}

export function endTrace(id: string, status?: 'ok' | 'error', error?: string) {
  if (!TRACE_PERSIST || !tracesRepo) return;
  tracesRepo.update(id, (t) => {
    t.endedAt = new Date().toISOString();
    if (status) t.status = status;
    if (error) t.error = error;
  });
}

export function beginSpan(traceId: string, span: Omit<Span, 'id' | 'start'> & { id?: string }): string {
  if (!TRACE_PERSIST || !tracesRepo) return '';
  const sid = span.id || newId();
  const now = new Date().toISOString();
  tracesRepo.update(traceId, (t) => {
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

export function endSpan(traceId: string, spanId: string, input?: { status?: 'ok' | 'error'; error?: string; response?: any }) {
  if (!TRACE_PERSIST || !tracesRepo) return;
  tracesRepo.update(traceId, (t) => {
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

export function annotateSpan(traceId: string, spanId: string, annotations: Record<string, any>) {
  if (!TRACE_PERSIST || !tracesRepo) return;
  tracesRepo.update(traceId, (t) => {
    const s = t.spans.find(x => x.id === spanId);
    if (!s) return;
    s.annotations = Object.assign({}, s.annotations || {}, annotations);
  });
}

export function getTraces() {
  return tracesRepo ? tracesRepo.getAll() : [];
}
