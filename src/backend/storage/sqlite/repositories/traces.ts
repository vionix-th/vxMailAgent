import type { Trace, Span } from '../../../../shared/types';
import { TRACE_TTL_DAYS, TRACE_MAX_SPANS } from '../../../config';
import type { StorageHandle } from '../types';
import { SqliteRepository, stringify } from './base';

function pruneTraces(db: any) {
  if (TRACE_TTL_DAYS > 0) {
    db.prepare('DELETE FROM traces WHERE created_at < datetime(?, ?)').run('now', `-${TRACE_TTL_DAYS} days`);
  }
}


function validateSpan(traceId: string, span: Span, index: number): Span {
  if (!span || typeof span !== 'object') {
    throw new Error(`trace ${traceId}: span ${index} invalid`);
  }
  if (typeof span.id !== 'string' || span.id.length === 0) {
    throw new Error(`trace ${traceId}: span ${index} missing id`);
  }
  if (typeof span.type !== 'string' || span.type.length === 0) {
    throw new Error(`trace ${traceId}: span ${index} missing type`);
  }
  if (typeof span.start !== 'string' || span.start.length === 0) {
    throw new Error(`trace ${traceId}: span ${index} missing start timestamp`);
  }
  return span;
}

function ensureTraceSpans(trace: Trace): Span[] {
  if (!Array.isArray(trace.spans)) {
    throw new Error(`trace ${trace.id} must include spans array`);
  }
  return trace.spans.map((span, index) => validateSpan(trace.id, span, index));
}

function rowToTrace(row: any, spans: Map<string, Span[]>): Trace {
  const spanList = spans.get(row.id);
  return {
    id: row.id,
    emailId: typeof row.email_id === 'string' ? row.email_id : undefined,
    accountId: row.account_id,
    provider: typeof row.provider === 'string' ? row.provider : undefined,
    createdAt: row.created_at,
    endedAt: typeof row.ended_at === 'string' ? row.ended_at : undefined,
    status: typeof row.status === 'string' ? row.status : undefined,
    error: typeof row.error === 'string' ? row.error : undefined,
    spans: spanList ? spanList : [],
  } as Trace;
}

function loadSpans(db: any, traceIds?: string[]): Map<string, Span[]> {
  let rows;
  if (traceIds && traceIds.length > 0) {
    const placeholders = traceIds.map(() => '?').join(',');
    rows = db.prepare(
      `SELECT trace_id, span_id, parent_id, type, name, status, error, start_at, end_at, duration_ms, provider, director_id, agent_id, tool_call_id, request_json, response_json, annotations_json
       FROM trace_spans WHERE trace_id IN (${placeholders}) ORDER BY trace_id, start_at`
    ).all(...traceIds);
  } else {
    rows = db.prepare(
      'SELECT trace_id, span_id, parent_id, type, name, status, error, start_at, end_at, duration_ms, provider, director_id, agent_id, tool_call_id, request_json, response_json, annotations_json FROM trace_spans ORDER BY trace_id, start_at'
    ).all();
  }
  const map = new Map<string, Span[]>();
  for (const row of rows) {
    const list = map.get(row.trace_id) ?? [];
    list.push({
      id: row.span_id,
      parentId: row.parent_id ?? undefined,
      type: row.type,
      name: row.name ?? undefined,
      status: row.status ?? undefined,
      error: row.error ?? undefined,
      start: row.start_at,
      end: row.end_at ?? undefined,
      durationMs: typeof row.duration_ms === 'number' ? row.duration_ms : undefined,
      provider: row.provider ?? undefined,
      directorId: row.director_id ?? undefined,
      agentId: row.agent_id ?? undefined,
      toolCallId: row.tool_call_id ?? undefined,
      request: row.request_json ? JSON.parse(row.request_json) : undefined,
      response: row.response_json ? JSON.parse(row.response_json) : undefined,
      annotations: row.annotations_json ? JSON.parse(row.annotations_json) : undefined,
    });
    map.set(row.trace_id, list);
  }
  return map;
}

export class TracesRepository extends SqliteRepository {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async list(): Promise<Trace[]> {
    return this.withConnection((db) => {
      const traces = db.prepare(
        'SELECT id, email_id, account_id, provider, created_at, ended_at, status, error FROM traces ORDER BY created_at DESC'
      ).all();
      const spans = loadSpans(db);
      return traces.map((row: any) => rowToTrace(row, spans));
    });
  }

  async append(trace: Trace): Promise<void> {
    await this.transaction((db) => {
      this.insertTrace(db, trace);
      pruneTraces(db);
      return undefined;
    });
  }

  async update(id: string, updater: (t: Trace) => Trace | void): Promise<void> {
    await this.transaction((db) => {
      const row = db.prepare(
        'SELECT id, email_id, account_id, provider, created_at, ended_at, status, error FROM traces WHERE id = ?'
      ).get(id);
      if (!row) return;
      const spans = loadSpans(db, [id]);
      const current = rowToTrace(row, spans);
      const cloned = JSON.parse(JSON.stringify(current)) as Trace;
      const result = updater(cloned);
      const next = result ?? cloned;
      db.prepare('DELETE FROM trace_spans WHERE trace_id = ?').run(id);
      db.prepare('DELETE FROM traces WHERE id = ?').run(id);
      this.insertTrace(db, next);
      pruneTraces(db);
      return undefined;
    });
  }

  async replace(traces: Trace[]): Promise<void> {
    await this.transaction((db) => {
      db.prepare('DELETE FROM trace_spans').run();
      db.prepare('DELETE FROM traces').run();
      for (const trace of traces) {
        this.insertTrace(db, trace);
      }
      pruneTraces(db);
      return undefined;
    });
  }

  async clear(): Promise<void> {
    await this.transaction((db) => {
      db.prepare('DELETE FROM trace_spans').run();
      db.prepare('DELETE FROM traces').run();
      return undefined;
    });
  }

  private insertTrace(db: any, trace: Trace): void {
    db.prepare(
      'INSERT INTO traces (id, email_id, account_id, provider, created_at, ended_at, status, error) VALUES (@id, @email_id, @account_id, @provider, @created_at, @ended_at, @status, @error)'
    ).run({
      id: trace.id,
      email_id: trace.emailId ?? null,
      account_id: trace.accountId,
      provider: trace.provider ?? null,
      created_at: trace.createdAt,
      ended_at: trace.endedAt ?? null,
      status: trace.status ?? null,
      error: trace.error ?? null,
    });
    const spans = ensureTraceSpans(trace).slice(0, TRACE_MAX_SPANS);
    const insertSpan = db.prepare(
      'INSERT INTO trace_spans (trace_id, span_id, parent_id, type, name, status, error, start_at, end_at, duration_ms, provider, director_id, agent_id, tool_call_id, request_json, response_json, annotations_json) VALUES (@trace_id, @span_id, @parent_id, @type, @name, @status, @error, @start_at, @end_at, @duration_ms, @provider, @director_id, @agent_id, @tool_call_id, @request_json, @response_json, @annotations_json)'
    );
    spans.forEach((span) => {
      insertSpan.run({
        trace_id: trace.id,
        span_id: span.id,
        parent_id: span.parentId ?? null,
        type: span.type,
        name: span.name ?? null,
        status: span.status ?? null,
        error: span.error ?? null,
        start_at: span.start,
        end_at: span.end ?? null,
        duration_ms: typeof span.durationMs === 'number' ? span.durationMs : null,
        provider: span.provider ?? null,
        director_id: span.directorId ?? null,
        agent_id: span.agentId ?? null,
        tool_call_id: span.toolCallId ?? null,
        request_json: span.request ? stringify(span.request) : null,
        response_json: span.response ? stringify(span.response) : null,
        annotations_json: span.annotations ? stringify(span.annotations) : null,
      });
    });
  }
}
