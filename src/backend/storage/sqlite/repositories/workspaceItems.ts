import type { WorkspaceItem } from '../../../../shared/types';
import type { StorageHandle } from '../types';
import { SqliteRepository, stringify } from './base';

export class WorkspaceItemsRepository extends SqliteRepository {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async getByConversation(conversationId: string): Promise<WorkspaceItem[]> {
    return this.withConnection((db) => {
      const items = db.prepare(
        'SELECT id, content_json, metadata_json, provenance_json, lifecycle_json, conversation_id FROM workspace_items WHERE conversation_id = ?'
      ).all(conversationId) as any[];
      const tags = db.prepare(
        'SELECT t.item_id, t.tag FROM workspace_item_tags t JOIN workspace_items w ON w.id = t.item_id WHERE w.conversation_id = ?'
      ).all(conversationId) as any[];
      const tagMap = new Map<string, string[]>();
      for (const row of tags) {
        const list = tagMap.get(row.item_id) ?? [];
        list.push(row.tag);
        tagMap.set(row.item_id, list);
      }
      return items.map((row: any) => {
        const metadata = row.metadata_json ? JSON.parse(row.metadata_json) : {};
        metadata.tags = tagMap.get(row.id) ?? [];
        return {
          id: row.id,
          content: JSON.parse(row.content_json),
          metadata,
          provenance: JSON.parse(row.provenance_json),
          lifecycle: JSON.parse(row.lifecycle_json),
        } as WorkspaceItem;
      });
    });
  }

  async getAll(): Promise<WorkspaceItem[]> {
    return this.withConnection((db) => {
      const items = db.prepare(
        'SELECT id, content_json, metadata_json, provenance_json, lifecycle_json, conversation_id FROM workspace_items'
      ).all() as any[];
      const tags = db.prepare('SELECT item_id, tag FROM workspace_item_tags').all() as any[];
      const tagMap = new Map<string, string[]>();
      for (const row of tags) {
        const list = tagMap.get(row.item_id) ?? [];
        list.push(row.tag);
        tagMap.set(row.item_id, list);
      }
      return items.map((row: any) => {
        const metadata = row.metadata_json ? JSON.parse(row.metadata_json) : {};
        metadata.tags = tagMap.get(row.id) ?? [];
        return {
          id: row.id,
          content: JSON.parse(row.content_json),
          metadata,
          provenance: JSON.parse(row.provenance_json),
          lifecycle: JSON.parse(row.lifecycle_json),
        } as WorkspaceItem;
      });
    });
  }

  async setAll(items: WorkspaceItem[]): Promise<void> {
    await this.transaction((db) => {
      db.prepare('DELETE FROM workspace_item_tags').run();
      db.prepare('DELETE FROM workspace_items').run();
      const insertItem = db.prepare(
        'INSERT INTO workspace_items (id, content_json, metadata_json, provenance_json, lifecycle_json, conversation_id) VALUES (@id, @content_json, @metadata_json, @provenance_json, @lifecycle_json, @conversation_id)'
      );
      const insertTag = db.prepare('INSERT INTO workspace_item_tags (item_id, tag) VALUES (@item_id, @tag)');
      for (const item of items) {
        insertItem.run({
          id: item.id,
          content_json: stringify(item.content),
          metadata_json: stringify({ ...(item.metadata ?? {}), tags: undefined }),
          provenance_json: stringify(item.provenance),
          lifecycle_json: stringify(item.lifecycle),
          conversation_id: item.provenance?.conversationId ?? null,
        });
        const tags = Array.isArray(item.metadata?.tags) ? item.metadata.tags : [];
        for (const tag of tags) {
          insertTag.run({ item_id: item.id, tag });
        }
      }
      return undefined;
    });
  }
}
