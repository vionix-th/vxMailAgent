import type { MemoryEntry } from '../../../../shared/types';
import type { StorageHandle, BetterSqliteDatabase } from '../types';
import { SqliteRepository, stringify } from './base';

export class MemoryRepository extends SqliteRepository {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async list(): Promise<readonly MemoryEntry[]> {
    return this.withConnection((db) => this.readAll(db));
  }

  async findById(id: string): Promise<MemoryEntry | null> {
    this.assertId(id);
    return this.withConnection((db) => this.readOne(db, id));
  }

  async insert(entry: MemoryEntry): Promise<void> {
    this.assertEntry(entry);
    await this.transaction((db) => {
      const exists = db.prepare('SELECT 1 FROM memory_entries WHERE id = ?').get(entry.id);
      if (exists) {
        throw new Error(`MemoryRepository: entry '${entry.id}' already exists`);
      }
      this.writeEntry(db, entry);
      return undefined;
    });
  }

  async update(entry: MemoryEntry): Promise<void> {
    this.assertEntry(entry);
    await this.transaction((db) => {
      const exists = db.prepare('SELECT 1 FROM memory_entries WHERE id = ?').get(entry.id);
      if (!exists) {
        throw new Error(`MemoryRepository: entry '${entry.id}' not found`);
      }
      this.writeEntry(db, entry);
      return undefined;
    });
  }

  async delete(id: string): Promise<boolean> {
    this.assertId(id);
    return this.transaction((db) => {
      db.prepare('DELETE FROM memory_entry_tags WHERE entry_id = ?').run(id);
      const result = db.prepare('DELETE FROM memory_entries WHERE id = ?').run(id);
      return result.changes > 0;
    });
  }

  async deleteMany(ids: readonly string[]): Promise<number> {
    if (!Array.isArray(ids) || ids.length === 0) return 0;
    const trimmed = ids.map((value) => {
      this.assertId(value);
      return value.trim();
    });
    return this.transaction((db) => {
      const placeholders = trimmed.map(() => '?').join(',');
      db.prepare(`DELETE FROM memory_entry_tags WHERE entry_id IN (${placeholders})`).run(trimmed);
      const result = db.prepare(`DELETE FROM memory_entries WHERE id IN (${placeholders})`).run(trimmed);
      return result.changes ?? 0;
    });
  }

  async upsert(entry: MemoryEntry): Promise<MemoryEntry> {
    this.assertEntry(entry);
    await this.transaction((db) => {
      this.writeEntry(db, entry);
      return undefined;
    });
    return entry;
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
      const entryTags = tagMap.get(row.id);
      return {
        id: row.id,
        scope: row.scope,
        content: row.content,
        created: row.created_at,
        updated: row.updated_at,
        owner: row.owner,
        relatedEmailId: typeof row.related_email_id === 'string' ? row.related_email_id : undefined,
        metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
        ...(entryTags ? { tags: entryTags } : {}),
      } as MemoryEntry;
    });
  }

  private readOne(db: BetterSqliteDatabase, id: string): MemoryEntry | null {
    const row = db
      .prepare(
        'SELECT id, scope, content, created_at, updated_at, owner, related_email_id, metadata_json FROM memory_entries WHERE id = ?'
      )
      .get(id) as any;
    if (!row) return null;
    const tags = db.prepare('SELECT tag FROM memory_entry_tags WHERE entry_id = ?').all(id) as any[];
    return {
      id: row.id,
      scope: row.scope,
      content: row.content,
      created: row.created_at,
      updated: row.updated_at,
      owner: row.owner,
      relatedEmailId: typeof row.related_email_id === 'string' ? row.related_email_id : undefined,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
      ...(tags.length ? { tags: tags.map((t) => t.tag) } : {}),
    } as MemoryEntry;
  }

  private writeEntry(db: BetterSqliteDatabase, entry: MemoryEntry): void {
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

  private assertId(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('MemoryRepository: id is required');
    }
  }

  private assertEntry(entry: MemoryEntry): void {
    if (!entry || typeof entry !== 'object') {
      throw new Error('MemoryRepository: entry payload required');
    }
    this.assertId(entry.id);
    if (typeof entry.scope !== 'string' || !entry.scope.trim()) {
      throw new Error(`MemoryRepository: scope required for '${entry.id}'`);
    }
    if (typeof entry.content !== 'string' || !entry.content.trim()) {
      throw new Error(`MemoryRepository: content required for '${entry.id}'`);
    }
    if (typeof entry.created !== 'string' || !entry.created.trim()) {
      throw new Error(`MemoryRepository: created timestamp required for '${entry.id}'`);
    }
    if (typeof entry.updated !== 'string' || !entry.updated.trim()) {
      throw new Error(`MemoryRepository: updated timestamp required for '${entry.id}'`);
    }
    if (typeof entry.owner !== 'string' || !entry.owner.trim()) {
      throw new Error(`MemoryRepository: owner required for '${entry.id}'`);
    }
  }
}
