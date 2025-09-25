import type { WorkspaceItem } from '../../../../shared/types';
import type { StorageHandle, BetterSqliteDatabase } from '../types';
import { SqliteRepository, stringify } from './base';

export class WorkspaceItemsRepository extends SqliteRepository {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async list(): Promise<readonly WorkspaceItem[]> {
    return this.withConnection((db) => this.selectItems(db));
  }

  async listByConversation(conversationId: string): Promise<readonly WorkspaceItem[]> {
    this.assertId(conversationId, 'conversation');
    return this.withConnection((db) => this.selectItems(db, 'WHERE conversation_id = ?', [conversationId]));
  }

  async getById(id: string): Promise<WorkspaceItem | null> {
    this.assertId(id, 'workspace item');
    return this.withConnection((db) => this.selectItem(db, id));
  }

  async insert(item: WorkspaceItem): Promise<void> {
    this.assertItem(item);
    await this.transaction((db) => {
      const exists = db.prepare('SELECT 1 FROM workspace_items WHERE id = ?').get(item.id);
      if (exists) {
        throw new Error(`WorkspaceItemsRepository: item '${item.id}' already exists`);
      }
      this.writeItem(db, item);
      return undefined;
    });
  }

  async update(item: WorkspaceItem): Promise<void> {
    this.assertItem(item);
    await this.transaction((db) => {
      const exists = db.prepare('SELECT 1 FROM workspace_items WHERE id = ?').get(item.id);
      if (!exists) {
        throw new Error(`WorkspaceItemsRepository: item '${item.id}' not found`);
      }
      this.writeItem(db, item);
      return undefined;
    });
  }

  async delete(id: string): Promise<boolean> {
    this.assertId(id, 'workspace item');
    return this.transaction((db) => {
      db.prepare('DELETE FROM workspace_item_tags WHERE item_id = ?').run(id);
      const result = db.prepare('DELETE FROM workspace_items WHERE id = ?').run(id);
      return result.changes > 0;
    });
  }

  async deleteByConversation(conversationId: string): Promise<number> {
    this.assertId(conversationId, 'conversation');
    return this.transaction((db) => {
      db.prepare(
        'DELETE FROM workspace_item_tags WHERE item_id IN (SELECT id FROM workspace_items WHERE conversation_id = ?)' 
      ).run(conversationId);
      const result = db.prepare('DELETE FROM workspace_items WHERE conversation_id = ?').run(conversationId);
      return result.changes ?? 0;
    });
  }

  async replaceForConversation(conversationId: string, items: WorkspaceItem[]): Promise<void> {
    this.assertId(conversationId, 'conversation');
    await this.transaction((db) => {
      db.prepare(
        'DELETE FROM workspace_item_tags WHERE item_id IN (SELECT id FROM workspace_items WHERE conversation_id = ?)' 
      ).run(conversationId);
      db.prepare('DELETE FROM workspace_items WHERE conversation_id = ?').run(conversationId);
      for (const item of items) {
        this.writeItem(db, { ...item, provenance: { ...item.provenance, conversationId } });
      }
      return undefined;
    });
  }

  private selectItems(db: BetterSqliteDatabase, clause: string = '', params: any[] = []): WorkspaceItem[] {
    const rows = db
      .prepare(
        `SELECT id, content_json, metadata_json, provenance_json, lifecycle_json, conversation_id
         FROM workspace_items ${clause}`
      )
      .all(...params) as any[];
    const tagMap = new Map<string, string[]>();
    if (rows.length) {
      const ids = rows.map((row) => row.id);
      const placeholders = ids.map(() => '?').join(',');
      const tagRows = db
        .prepare(`SELECT item_id, tag FROM workspace_item_tags WHERE item_id IN (${placeholders})`)
        .all(...ids) as any[];
      for (const row of tagRows) {
        const list = tagMap.get(row.item_id) ?? [];
        list.push(row.tag);
        tagMap.set(row.item_id, list);
      }
    }
    return rows.map((row) => this.mapRow(row, tagMap.get(row.id)));
  }

  private selectItem(db: BetterSqliteDatabase, id: string): WorkspaceItem | null {
    const row = db
      .prepare(
        'SELECT id, content_json, metadata_json, provenance_json, lifecycle_json, conversation_id FROM workspace_items WHERE id = ?'
      )
      .get(id) as any;
    if (!row) return null;
    const tags = db.prepare('SELECT tag FROM workspace_item_tags WHERE item_id = ?').all(id) as any[];
    return this.mapRow(row, tags.map((t) => t.tag));
  }

  private mapRow(row: any, tags: string[] | undefined): WorkspaceItem {
    const metadataRaw = row.metadata_json ? JSON.parse(row.metadata_json) : {};
    const provenance = JSON.parse(row.provenance_json);
    const lifecycle = JSON.parse(row.lifecycle_json);
    return {
      id: row.id,
      content: JSON.parse(row.content_json),
      metadata: {
        ...metadataRaw,
        tags: Array.isArray(metadataRaw?.tags) ? metadataRaw.tags : tags ?? [],
      },
      provenance,
      lifecycle,
    } as WorkspaceItem;
  }

  private writeItem(db: BetterSqliteDatabase, item: WorkspaceItem): void {
    const conversationId = item.provenance?.conversationId ?? null;
    db.prepare(
      `INSERT INTO workspace_items (id, content_json, metadata_json, provenance_json, lifecycle_json, conversation_id)
       VALUES (@id, @content_json, @metadata_json, @provenance_json, @lifecycle_json, @conversation_id)
       ON CONFLICT(id) DO UPDATE SET
         content_json = excluded.content_json,
         metadata_json = excluded.metadata_json,
         provenance_json = excluded.provenance_json,
         lifecycle_json = excluded.lifecycle_json,
         conversation_id = excluded.conversation_id`
    ).run({
      id: item.id,
      content_json: stringify(item.content),
      metadata_json: stringify({ ...(item.metadata ?? {}), tags: undefined }),
      provenance_json: stringify(item.provenance),
      lifecycle_json: stringify(item.lifecycle),
      conversation_id: conversationId,
    });
    db.prepare('DELETE FROM workspace_item_tags WHERE item_id = @item_id').run({ item_id: item.id });
    const tags = Array.isArray(item.metadata?.tags)
      ? item.metadata.tags.filter((tag) => typeof tag === 'string' && tag.trim().length > 0)
      : [];
    if (tags.length) {
      const insertTag = db.prepare('INSERT INTO workspace_item_tags (item_id, tag) VALUES (@item_id, @tag)');
      for (const tag of tags) {
        insertTag.run({ item_id: item.id, tag });
      }
    }
  }

  private assertId(value: unknown, label: string): asserts value is string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`WorkspaceItemsRepository: ${label} id is required`);
    }
  }

  private assertItem(item: WorkspaceItem): void {
    if (!item || typeof item !== 'object') {
      throw new Error('WorkspaceItemsRepository: item payload required');
    }
    this.assertId(item.id, 'workspace item');
    if (!item.provenance || typeof item.provenance !== 'object') {
      throw new Error(`WorkspaceItemsRepository: provenance required for '${item.id}'`);
    }
    this.assertId(item.provenance.conversationId ?? '', 'conversation');
    if (typeof item.lifecycle?.revision !== 'number') {
      throw new Error(`WorkspaceItemsRepository: lifecycle.revision required for '${item.id}'`);
    }
  }
}
