import type { MemoryEntry } from '../../../../shared/types';
import type { StorageHandle } from '../types';
import { SqliteRepository, stringify } from './base';

export class MemoryRepository extends SqliteRepository {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async getAll(): Promise<MemoryEntry[]> {
    return this.withConnection((db) => {
      const entries = db.prepare(
        'SELECT id, scope, content, created_at, updated_at, owner, related_email_id, metadata_json FROM memory_entries'
      ).all() as any[];
      const tags = db.prepare('SELECT entry_id, tag FROM memory_entry_tags').all() as any[];
      const tagMap = new Map<string, string[]>();
      for (const row of tags) {
        const list = tagMap.get(row.entry_id) ?? [];
        list.push(row.tag);
        tagMap.set(row.entry_id, list);
      }
      return entries.map((row: any) => {
        if (!row.owner) {
          throw new Error(`memory entry missing owner (id=${row.id})`);
        }
        const tags = tagMap.get(row.id);
        return {
          id: row.id,
          scope: row.scope,
          content: row.content,
          created: row.created_at,
          updated: row.updated_at,
          owner: row.owner,
          relatedEmailId: typeof row.related_email_id === 'string' ? row.related_email_id : undefined,
          metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
          ...(tags ? { tags } : {}),
        } as MemoryEntry;
      });
    });
  }

  async setAll(entries: MemoryEntry[]): Promise<void> {
    await this.transaction((db) => {
      db.prepare('DELETE FROM memory_entry_tags').run();
      db.prepare('DELETE FROM memory_entries').run();
      const insertEntry = db.prepare(
        'INSERT INTO memory_entries (id, scope, content, created_at, updated_at, owner, related_email_id, metadata_json) VALUES (@id, @scope, @content, @created_at, @updated_at, @owner, @related_email_id, @metadata_json)'
      );
      const insertTag = db.prepare('INSERT INTO memory_entry_tags (entry_id, tag) VALUES (@entry_id, @tag)');
      for (const entry of entries) {
        insertEntry.run({
          id: entry.id,
          scope: entry.scope,
          content: entry.content,
          created_at: entry.created,
          updated_at: entry.updated,
          owner: entry.owner,
          related_email_id: entry.relatedEmailId ?? null,
          metadata_json: entry.metadata ? stringify(entry.metadata) : null,
        });
        const tags = Array.isArray(entry.tags) ? entry.tags : [];
        for (const tag of tags) {
          insertTag.run({ entry_id: entry.id, tag });
        }
      }
      return undefined;
    });
  }
}
