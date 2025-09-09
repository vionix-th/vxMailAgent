import { WorkspaceItem, ConversationThread } from '../../shared/types';
import { ValidationError, NotFoundError } from './error-handler';
import { newId } from '../utils/id';

export type GetItemsFn = () => Promise<WorkspaceItem[]>;
export type SetItemsFn = (next: WorkspaceItem[]) => Promise<void>;
export type GetConversationsFn = () => Promise<ConversationThread[]>;
export type SetConversationsFn = (next: ConversationThread[]) => Promise<void>;

export interface WorkspaceServiceDeps {
  getItems: GetItemsFn;
  setItems: SetItemsFn;
  getConversations?: GetConversationsFn;
  setConversations?: SetConversationsFn;
}

export class WorkspaceService {
  private readonly getItems: GetItemsFn;
  private readonly setItems: SetItemsFn;
  private readonly getConversations?: GetConversationsFn;
  private readonly setConversations?: SetConversationsFn;

  constructor(deps: WorkspaceServiceDeps) {
    this.getItems = deps.getItems;
    this.setItems = deps.setItems;
    this.getConversations = deps.getConversations;
    this.setConversations = deps.setConversations;
  }

  async listItems(includeDeleted: boolean = false): Promise<WorkspaceItem[]> {
    const items = await this.getItems();
    return includeDeleted ? items : items.filter(i => !i.deleted);
    }

  async getItem(id: string): Promise<WorkspaceItem | null> {
    const items = await this.getItems();
    return items.find(i => i.id === id) || null;
  }

  async addItem(input: Omit<WorkspaceItem, 'id' | 'created' | 'updated' | 'revision' | 'deleted'> & Partial<Pick<WorkspaceItem, 'label' | 'description' | 'mimeType' | 'encoding' | 'data' | 'tags'>>): Promise<WorkspaceItem> {
    this.validateEncoding(input.encoding);

    const now = new Date().toISOString();
    const item: WorkspaceItem = {
      id: newId(),
      label: input.label || 'Untitled',
      description: input.description,
      mimeType: input.mimeType || 'text/plain',
      encoding: (input.encoding as any) || 'utf8',
      data: input.data || '',
      tags: input.tags ?? [],
      created: now,
      updated: now,
      revision: 1,
      context: input.context,
    };

    const items = await this.getItems();
    await this.setItems([...items, item]);
    return item;
  }

  async updateItem(id: string, patch: Partial<WorkspaceItem>, expectedRevision?: number): Promise<WorkspaceItem> {
    if (typeof patch.encoding !== 'undefined') {
      this.validateEncoding(patch.encoding);
    }

    const items = await this.getItems();
    const idx = items.findIndex(i => i.id === id);
    if (idx === -1) throw new NotFoundError('Item not found');

    const current = items[idx];
    const currentRevision = current.revision ?? 0;
    if (typeof expectedRevision === 'number' && currentRevision !== expectedRevision) {
      throw new ValidationError(`Revision conflict (current=${currentRevision})`);
    }

    const updated: WorkspaceItem = {
      ...current,
      ...patch,
      updated: new Date().toISOString(),
      revision: currentRevision + 1,
    };

    const next = items.slice();
    next[idx] = updated;
    await this.setItems(next);
    return updated;
  }

  async softDeleteItem(id: string): Promise<WorkspaceItem> {
    const items = await this.getItems();
    const idx = items.findIndex(i => i.id === id);
    if (idx === -1) throw new NotFoundError('Item not found');

    const current = items[idx];
    const nextItem: WorkspaceItem = {
      ...current,
      deleted: true,
      updated: new Date().toISOString(),
      revision: (current.revision ?? 0) + 1,
    };

    const next = items.slice();
    next[idx] = nextItem;
    await this.setItems(next);
    return nextItem;
  }

  async hardDeleteItem(id: string): Promise<void> {
    const items = await this.getItems();
    const next = items.filter(i => i.id !== id);
    await this.setItems(next);
  }

  async updateConversationWorkspaceAssociation(conversationId: string, workspaceId: string): Promise<void> {
    if (!this.getConversations || !this.setConversations) return; // Optional dependency
    const conversations = await this.getConversations();
    const idx = conversations.findIndex(c => c.id === conversationId);
    if (idx === -1) throw new NotFoundError('Conversation not found');
    const updated = { ...conversations[idx], workspaceId } as ConversationThread as any;
    const next = conversations.slice();
    next[idx] = updated;
    await this.setConversations(next);
  }

  /**
   * Purge all workspace items for the current user. Returns the number of deleted items.
   */
  async purgeAll(): Promise<number> {
    const items = await this.getItems();
    const count = Array.isArray(items) ? items.length : 0;
    await this.setItems([]);
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
