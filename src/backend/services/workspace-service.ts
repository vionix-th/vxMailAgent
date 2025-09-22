import { WorkspaceItem, ConversationThread } from '../../shared/types';
import { ValidationError, NotFoundError } from './error-handler';
import { newId } from '../utils/id';
import { WorkspaceItemInput } from '../../shared/types';

export type GetItemsFn = () => Promise<WorkspaceItem[]>;
export type MutateItemsFn = (
  updater: (current: WorkspaceItem[]) => Promise<WorkspaceItem[]> | WorkspaceItem[]
) => Promise<WorkspaceItem[]>;
export type GetConversationsFn = () => Promise<ConversationThread[]>;
export type SetConversationsFn = (next: ConversationThread[]) => Promise<void>;

export interface WorkspaceServiceDeps {
  getItems: GetItemsFn;
  mutateItems: MutateItemsFn;
  getConversations?: GetConversationsFn;
  setConversations?: SetConversationsFn;
}

export class WorkspaceService {
  private readonly getItems: GetItemsFn;
  private readonly mutateItems: MutateItemsFn;

  constructor(deps: WorkspaceServiceDeps) {
    this.getItems = deps.getItems;
    if (typeof deps.mutateItems !== 'function') {
      throw new Error('WorkspaceService requires mutateItems dependency');
    }
    this.mutateItems = deps.mutateItems;
    // Conversation association is derivable; optional deps intentionally unused.
  }

  async listItems(includeDeleted: boolean = false): Promise<WorkspaceItem[]> {
    const items = await this.getItems();
    return includeDeleted ? items : items.filter(i => !i.lifecycle.deleted);
  }

  async getItem(id: string): Promise<WorkspaceItem | null> {
    const items = await this.getItems();
    return items.find(i => i.id === id) || null;
  }

  async addItem(input: WorkspaceItemInput): Promise<WorkspaceItem> {
    this.validateEncoding(input.content.encoding);
    // Enforce array semantics for tags when provided
    const tagsAny = (input as any)?.metadata?.tags;
    if (typeof tagsAny !== 'undefined' && !Array.isArray(tagsAny)) {
      throw new ValidationError('metadata.tags must be an array of strings');
    }

    const nowIso = () => new Date().toISOString();
    const item: WorkspaceItem = {
      id: newId(),
      content: input.content,
      metadata: {
        ...(typeof input.metadata.label !== 'undefined' ? { label: input.metadata.label } : {}),
        ...(typeof input.metadata.description !== 'undefined' ? { description: input.metadata.description } : {}),
        tags: Array.isArray(input.metadata.tags) ? input.metadata.tags : [],
      },
      provenance: input.provenance,
      lifecycle: {
        created: nowIso(),
        updated: nowIso(),
        revision: 1,
        deleted: false,
      },
    };

    await this.mutateItems((current) => [...current, item]);
    return item;
  }

  async updateItem(id: string, patch: Partial<WorkspaceItem>, expectedRevision?: number): Promise<WorkspaceItem> {
    if (patch.content && typeof patch.content.encoding !== 'undefined') {
      this.validateEncoding(patch.content.encoding);
    }
    // Enforce array semantics if tags provided in patch
    const pTags = (patch as any)?.metadata?.tags;
    if (typeof pTags !== 'undefined' && !Array.isArray(pTags)) {
      throw new ValidationError('metadata.tags must be an array of strings');
    }

    let updated: WorkspaceItem | null = null;
    await this.mutateItems((current) => {
      const idx = current.findIndex(i => i.id === id);
      if (idx === -1) {
        throw new NotFoundError('Item not found');
      }
      const target = current[idx];
      const currentRevision = target.lifecycle.revision ?? 0;
      if (typeof expectedRevision === 'number' && currentRevision !== expectedRevision) {
        throw new ValidationError(`Revision mismatch: expected ${expectedRevision}, got ${currentRevision}`);
      }

      const nextItem: WorkspaceItem = {
        ...target,
        ...patch,
        lifecycle: {
          ...target.lifecycle,
          ...patch.lifecycle,
          updated: new Date().toISOString(),
          revision: currentRevision + 1,
        },
      };
      updated = nextItem;
      const next = current.slice();
      next[idx] = nextItem;
      return next;
    });
    if (!updated) {
      throw new NotFoundError('Item not found');
    }
    return updated;
  }

  async softDeleteItem(id: string): Promise<WorkspaceItem> {
    let deleted: WorkspaceItem | null = null;
    await this.mutateItems((current) => {
      const idx = current.findIndex(i => i.id === id);
      if (idx === -1) {
        throw new NotFoundError('Item not found');
      }
      const existing = current[idx];
      const nextItem: WorkspaceItem = {
        ...existing,
        lifecycle: {
          ...existing.lifecycle,
          deleted: true,
          updated: new Date().toISOString(),
          revision: (existing.lifecycle.revision ?? 0) + 1,
        },
      };
      deleted = nextItem;
      const next = current.slice();
      next[idx] = nextItem;
      return next;
    });
    if (!deleted) {
      throw new NotFoundError('Item not found');
    }
    return deleted;
  }

  async hardDeleteItem(id: string): Promise<void> {
    await this.mutateItems((current) => current.filter(i => i.id !== id));
  }

  // Note: Association is derivable by WorkspaceItem.provenance.conversationId.
  // No thread mutation is needed (or allowed) to add ad‑hoc fields.

  /**
   * Purge all workspace items for the current user. Returns the number of deleted items.
   */
  async purgeAll(): Promise<number> {
    let count = 0;
    await this.mutateItems((current) => {
      count = Array.isArray(current) ? current.length : 0;
      return [];
    });
    return count;
  }

  private validateEncoding(enc: any): void {
    if (typeof enc === 'undefined') return;
    const allowed = ['utf8', 'base64', 'binary'];
    if (!allowed.includes(enc)) {
      throw new ValidationError(`Invalid encoding: ${enc}`);
    }
  }
}
