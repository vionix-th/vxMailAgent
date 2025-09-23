import type { ProviderEvent } from '../../../../shared/types';
import { createProviderEvent } from '../../../../shared/constructors';
import { PROVIDER_TTL_DAYS, USER_MAX_LOGS_PER_TYPE } from '../../../config';
import type { StorageHandle } from '../types';
import { SqliteRepository, stringify } from './base';

function pruneProviderEvents(db: any) {
  if (PROVIDER_TTL_DAYS > 0) {
    db.prepare("DELETE FROM provider_events WHERE timestamp < datetime('now', ?)")
      .run(`-${PROVIDER_TTL_DAYS} days`);
  }
  if (USER_MAX_LOGS_PER_TYPE > 0) {
    const total = db.prepare('SELECT COUNT(*) AS c FROM provider_events').get()?.c as number;
    if (typeof total === 'number' && total > USER_MAX_LOGS_PER_TYPE) {
      const excess = total - USER_MAX_LOGS_PER_TYPE;
      db.prepare(`
        DELETE FROM provider_events
        WHERE id IN (
          SELECT id FROM provider_events
          ORDER BY timestamp ASC
          LIMIT ?
        )
      `).run(excess);
    }
  }
}

export class ProviderEventsRepository extends SqliteRepository {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async getByConversation(conversationId: string): Promise<ProviderEvent[]> {
    return this.withConnection((db) => {
      const rows = db.prepare(
        'SELECT id, conversation_id, provider, type, timestamp, latency_ms, usage_json, payload_json, error FROM provider_events WHERE conversation_id = ? ORDER BY timestamp'
      ).all(conversationId);
      return rows.map((row: any) => this.mapRow(row));
    });
  }

  async getAll(): Promise<ProviderEvent[]> {
    return this.withConnection((db) => {
      const rows = db.prepare(
        'SELECT id, conversation_id, provider, type, timestamp, latency_ms, usage_json, payload_json, error FROM provider_events ORDER BY timestamp'
      ).all();
      return rows.map((row: any) => this.mapRow(row));
    });
  }

  async setAll(events: ProviderEvent[]): Promise<void> {
    await this.transaction((db) => {
      db.prepare('DELETE FROM provider_events').run();
      const insert = db.prepare(
        'INSERT INTO provider_events (id, conversation_id, provider, type, timestamp, latency_ms, usage_json, payload_json, error) VALUES (@id, @conversation_id, @provider, @type, @timestamp, @latency_ms, @usage_json, @payload_json, @error)'
      );
      for (const event of events) {
        insert.run(this.prepareInsert(event));
      }
      pruneProviderEvents(db);
      return undefined;
    });
  }

  async append(event: ProviderEvent): Promise<void> {
    await this.transaction((db) => {
      db.prepare(
        'INSERT INTO provider_events (id, conversation_id, provider, type, timestamp, latency_ms, usage_json, payload_json, error) VALUES (@id, @conversation_id, @provider, @type, @timestamp, @latency_ms, @usage_json, @payload_json, @error)'
      ).run(this.prepareInsert(event));
      pruneProviderEvents(db);
      return undefined;
    });
  }

  private mapRow(row: any): ProviderEvent {
    const usage = row.usage_json ? JSON.parse(row.usage_json) : undefined;
    const payload = row.payload_json ? JSON.parse(row.payload_json) : undefined;
    const normalized = createProviderEvent({
      id: row.id,
      conversationId: row.conversation_id,
      provider: row.provider,
      type: row.type,
      timestamp: row.timestamp,
      latencyMs: typeof row.latency_ms === 'number' ? row.latency_ms : undefined,
      usage,
      payload,
      error: typeof row.error === 'string' ? row.error : undefined,
    });
    return normalized;
  }

  private prepareInsert(event: ProviderEvent) {
    const normalized = createProviderEvent(event as ProviderEvent);
    return {
      id: normalized.id,
      conversation_id: normalized.conversationId,
      provider: normalized.provider,
      type: normalized.type,
      timestamp: normalized.timestamp,
      latency_ms: typeof normalized.latencyMs === 'number' ? normalized.latencyMs : null,
      usage_json: normalized.usage ? stringify(normalized.usage) : null,
      payload_json: normalized.payload !== undefined ? stringify(normalized.payload) : null,
      error: typeof normalized.error === 'string' ? normalized.error : null,
    };
  }
}
