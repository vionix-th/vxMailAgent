import type { OrchestrationEvent } from '../../../../shared/types';
import { ORCHESTRATION_TTL_DAYS, USER_MAX_LOGS_PER_TYPE } from '../../../config';
import type { StorageHandle } from '../types';
import { SqliteRepository, stringify } from './base';

function pruneOrchestration(db: any) {
  if (ORCHESTRATION_TTL_DAYS > 0) {
    db.prepare('DELETE FROM orchestration_logs WHERE timestamp < datetime(?, ?)')
      .run('now', `-${ORCHESTRATION_TTL_DAYS} days`);
  }
  if (USER_MAX_LOGS_PER_TYPE > 0) {
    const total = db.prepare('SELECT COUNT(*) AS c FROM orchestration_logs').get()?.c as number;
    if (typeof total === 'number' && total > USER_MAX_LOGS_PER_TYPE) {
      const excess = total - USER_MAX_LOGS_PER_TYPE;
      db.prepare(`
        DELETE FROM orchestration_logs
        WHERE id IN (
          SELECT id FROM orchestration_logs
          ORDER BY timestamp ASC
          LIMIT ?
        )
      `).run(excess);
    }
  }
}

function requireConversationId(event: OrchestrationEvent): string {
  const id = (event as any)?.context?.conversationId;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`orchestration log ${event.id}: context.conversationId missing`);
  }
  return id;
}

export class OrchestrationLogRepository extends SqliteRepository {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async getByConversation(conversationId: string): Promise<OrchestrationEvent[]> {
    return this.withConnection((db) => {
      const rows = db.prepare(
        'SELECT id, conversation_id, timestamp, phase, outcome_json, context_json FROM orchestration_logs WHERE conversation_id = ? ORDER BY timestamp'
      ).all(conversationId);
      return rows.map((row: any) => {
        const context = JSON.parse(row.context_json);
        if (typeof context === 'object' && context) {
          context.conversationId = row.conversation_id;
        }
        return {
          id: row.id,
          timestamp: row.timestamp,
          phase: row.phase,
          outcome: JSON.parse(row.outcome_json),
          context,
        };
      });
    });
  }

  async getByConversationIds(conversationIds: readonly string[]): Promise<OrchestrationEvent[]> {
    if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
      return [];
    }
    return this.withConnection((db) => {
      const placeholders = conversationIds.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT id, conversation_id, timestamp, phase, outcome_json, context_json
           FROM orchestration_logs
           WHERE conversation_id IN (${placeholders})
           ORDER BY timestamp`
        )
        .all(...conversationIds);
      return rows.map((row: any) => {
        const context = JSON.parse(row.context_json);
        if (typeof context === 'object' && context) {
          context.conversationId = row.conversation_id;
        }
        return {
          id: row.id,
          timestamp: row.timestamp,
          phase: row.phase,
          outcome: JSON.parse(row.outcome_json),
          context,
        } as OrchestrationEvent;
      });
    });
  }

  async list(): Promise<OrchestrationEvent[]> {
    return this.withConnection((db) => {
      const rows = db.prepare(
        'SELECT id, conversation_id, timestamp, phase, outcome_json, context_json FROM orchestration_logs ORDER BY timestamp'
      ).all();
      return rows.map((row: any) => {
        const context = JSON.parse(row.context_json);
        if (typeof context === 'object' && context) {
          context.conversationId = row.conversation_id;
        }
        return {
          id: row.id,
          timestamp: row.timestamp,
          phase: row.phase,
          outcome: JSON.parse(row.outcome_json),
          context,
        } as OrchestrationEvent;
      });
    });
  }

  async replace(events: OrchestrationEvent[]): Promise<void> {
    await this.transaction((db) => {
      db.prepare('DELETE FROM orchestration_logs').run();
      const insert = db.prepare(
        'INSERT INTO orchestration_logs (id, conversation_id, timestamp, phase, outcome_json, context_json) VALUES (@id, @conversation_id, @timestamp, @phase, @outcome_json, @context_json)'
      );
      for (const event of events) {
        const conversationId = requireConversationId(event);
        insert.run({
          id: event.id,
          conversation_id: conversationId,
          timestamp: event.timestamp,
          phase: event.phase,
          outcome_json: stringify(event.outcome),
          context_json: stringify(event.context),
        });
      }
      pruneOrchestration(db);
      return undefined;
    });
  }

  async append(event: OrchestrationEvent): Promise<void> {
    await this.transaction((db) => {
      const conversationId = requireConversationId(event);
      db.prepare(
        'INSERT INTO orchestration_logs (id, conversation_id, timestamp, phase, outcome_json, context_json) VALUES (@id, @conversation_id, @timestamp, @phase, @outcome_json, @context_json)'
      ).run({
        id: event.id,
        conversation_id: conversationId,
        timestamp: event.timestamp,
        phase: event.phase,
        outcome_json: stringify(event.outcome),
        context_json: stringify(event.context),
      });
      pruneOrchestration(db);
      return undefined;
    });
  }

  async clear(): Promise<void> {
    await this.transaction((db) => {
      db.prepare('DELETE FROM orchestration_logs').run();
      return undefined;
    });
  }
}
