import type { MemoryEntry } from '../../../../shared/types';
import type { StorageHandle, BetterSqliteDatabase } from '../types';
import { SqliteRepository, stringify } from './base';

export class MemoryRepository extends SqliteRepository {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async getAll(): Promise<MemoryEntry[]> {
    return this.withConnection((db) => this.readAll(db));
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
          related_email_id: typeof entry.relatedEmailId === 'string' ? entry.relatedEmailId : null,
          metadata_json: typeof entry.metadata !== 'undefined' ? stringify(entry.metadata) : null,
        });
        const tags = Array.isArray(entry.tags) ? entry.tags : [];
        for (const tag of tags) {
          insertTag.run({ entry_id: entry.id, tag });
        }
      }
      return undefined;
    });
  }

  async upsert(entry: MemoryEntry): Promise<MemoryEntry> {
    return this.transaction((db) => {
      this.upsertUnsafe(db, entry);
      return entry;
    });
  }

  async deleteById(id: string): Promise<boolean> {
    return this.transaction((db) => {
      const result = db.prepare('DELETE FROM memory_entries WHERE id = ?').run(id);
      return result.changes > 0;
    });
  }

  async mutate(updater: (current: MemoryEntry[]) => Promise<MemoryEntry[]> | MemoryEntry[]): Promise<MemoryEntry[]> {
    return this.transaction(async (db) => {
      const current = this.readAll(db);
      const nextRaw = await updater([...current]);
      if (!Array.isArray(nextRaw)) {
        throw new Error('MemoryRepository.mutate updater must return MemoryEntry[]');
      }
      const next: MemoryEntry[] = [];
      const seen = new Set<string>();
      for (const entry of nextRaw) {
        if (!entry || typeof entry !== 'object' || typeof (entry as any).id !== 'string') {
          throw new Error('MemoryRepository.mutate received invalid MemoryEntry');
        }
        if (seen.has((entry as any).id)) {
          throw new Error(`MemoryRepository.mutate received duplicate id: ${(entry as any).id}`);
        }
        seen.add((entry as any).id);
        next.push(entry as MemoryEntry);
      }
      const currentIds = new Set(current.map((entry) => entry.id));
      const nextIds = new Set(next.map((entry) => entry.id));
      for (const id of currentIds) {
        if (!nextIds.has(id)) {
          db.prepare('DELETE FROM memory_entries WHERE id = ?').run(id);
        }
      }
      for (const entry of next) {
        this.upsertUnsafe(db, entry);
      }
      return this.readAll(db);
    });
  }

  private readAll(db: BetterSqliteDatabase): MemoryEntry[] {
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
  }

  private upsertUnsafe(db: BetterSqliteDatabase, entry: MemoryEntry): void {
    const payload = {
      id: entry.id,
      scope: entry.scope,
      content: entry.content,
      created_at: entry.created,
      updated_at: entry.updated,
      owner: entry.owner,
      related_email_id: typeof entry.relatedEmailId === 'string' ? entry.relatedEmailId : null,
      metadata_json: typeof entry.metadata !== 'undefined' ? stringify(entry.metadata) : null,
    };
    db.prepare(
      `INSERT INTO memory_entries (id, scope, content, created_at, updated_at, owner, related_email_id, metadata_json)
       VALUES (@id, @scope, @content, @created_at, @updated_at, @owner, @related_email_id, @metadata_json)
       ON CONFLICT(id) DO UPDATE SET
         scope=excluded.scope,
         content=excluded.content,
         created_at=excluded.created_at,
         updated_at=excluded.updated_at,
         owner=excluded.owner,
         related_email_id=excluded.related_email_id,
         metadata_json=excluded.metadata_json`
    ).run(payload);
    db.prepare('DELETE FROM memory_entry_tags WHERE entry_id = @entry_id').run({ entry_id: entry.id });
    const tags = Array.isArray(entry.tags)
      ? entry.tags.filter((tag) => typeof tag === 'string' && tag.trim().length > 0)
      : [];
    if (tags.length) {
      const insertTag = db.prepare('INSERT INTO memory_entry_tags (entry_id, tag) VALUES (@entry_id, @tag)');
      for (const tag of tags) {
        insertTag.run({ entry_id: entry.id, tag });
      }
    }
  }
}
