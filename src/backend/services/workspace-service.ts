import { WorkspaceItem, ConversationThread, WorkspaceContent } from '../../shared/types';
import { ValidationError, NotFoundError } from './error-handler';
import { newId } from '../utils/id';
import { WorkspaceItemInput } from '../../shared/types';

export type GetItemsFn = () => Promise<WorkspaceItem[]>;
export type SetItemsFn = (next: WorkspaceItem[]) => Promise<void>;
export type GetConversationsFn = () => Promise<ConversationThread[]>;
export type SetConversationsFn = (next: ConversationThread[]) => Promise<void>;

export interface WorkspaceServiceDeps {
  getItems: GetItemsFn;
  setItems: SetItemsFn;
  conversationId?: string;
  getConversations?: GetConversationsFn;
  setConversations?: SetConversationsFn;
}

export class WorkspaceService {
  private readonly getItems: GetItemsFn;
  private readonly setItems: SetItemsFn;
  private readonly conversationId?: string;

  constructor(deps: WorkspaceServiceDeps) {
    this.getItems = deps.getItems;
    this.setItems = deps.setItems;
    this.conversationId = deps.conversationId;
    // Conversation association is derivable; optional deps intentionally unused.
  }

  async listItems(includeDeleted: boolean = false): Promise<WorkspaceItem[]> {
    const items = await this.getItems();
    return includeDeleted ? items : items.filter(i => !i.lifecycle.deleted);
  }

  async getItem(id: string): Promise<WorkspaceItem | null> {
    this.requireConversationId();
    const items = await this.getItems();
    return items.find(i => i.id === id) || null;
  }

  async addItem(input: WorkspaceItemInput): Promise<WorkspaceItem> {
    const conversationId = this.requireConversationId();
    this.validateContent(input.content);

    if (!input.metadata || typeof input.metadata !== 'object') {
      throw new ValidationError('metadata is required');
    }

    // Enforce array semantics for tags when provided
    const tagsAny = (input as any)?.metadata?.tags;
    if (typeof tagsAny !== 'undefined' && !Array.isArray(tagsAny)) {
      throw new ValidationError('metadata.tags must be an array of strings');
    }

    if (!input.provenance || typeof input.provenance !== 'object') {
      throw new ValidationError('provenance is required');
    }

    const provenance: any = { ...input.provenance };
    if (typeof provenance.conversationId === 'string' && provenance.conversationId !== conversationId) {
      throw new ValidationError('provenance.conversationId mismatch');
    }
    if (typeof provenance.emailId !== 'string' || !provenance.emailId) {
      throw new ValidationError('provenance.emailId is required');
    }
    if (typeof provenance.createdBy !== 'string' || !provenance.createdBy) {
      throw new ValidationError('provenance.createdBy is required');
    }
    if (typeof provenance.creatorId !== 'string' || !provenance.creatorId) {
      throw new ValidationError('provenance.creatorId is required');
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
      provenance: { ...provenance, conversationId } as WorkspaceItem['provenance'],
      lifecycle: {
        created: nowIso(),
        updated: nowIso(),
        revision: 1,
        deleted: false,
      },
    };

    const items = await this.getItems();
    await this.setItems([...items, item]);
    return item;
  }

  async updateItem(id: string, patch: Partial<WorkspaceItem>, expectedRevision?: number): Promise<WorkspaceItem> {
    const conversationId = this.requireConversationId();
    // Enforce array semantics if tags provided in patch
    const pTags = (patch as any)?.metadata?.tags;
    if (typeof pTags !== 'undefined' && !Array.isArray(pTags)) {
      throw new ValidationError('metadata.tags must be an array of strings');
    }

    const items = await this.getItems();
    const idx = items.findIndex(i => i.id === id);
    if (idx === -1) throw new NotFoundError('Item not found');

    const current = items[idx];
    const currentConversation = current?.provenance?.conversationId;
    if (currentConversation && currentConversation !== conversationId) {
      throw new ValidationError('Workspace item conversation mismatch');
    }

    const patchCopy: Partial<WorkspaceItem> = { ...patch };
    let nextProvenance: WorkspaceItem['provenance'] = { ...current.provenance, conversationId } as WorkspaceItem['provenance'];
    if ('provenance' in patchCopy) {
      const provPatch = (patchCopy as any).provenance;
      delete (patchCopy as any).provenance;
      if (provPatch && typeof provPatch === 'object') {
        if (typeof provPatch.conversationId !== 'undefined' && provPatch.conversationId !== conversationId) {
          throw new ValidationError('Cannot move workspace item to a different conversation');
        }
        nextProvenance = { ...nextProvenance, ...provPatch, conversationId };
      }
    }

    if (patchCopy.content) {
      const nextContent: WorkspaceContent = { ...current.content, ...patchCopy.content };
      this.validateContent(nextContent);
      patchCopy.content = nextContent;
    }
    const currentRevision = current.lifecycle.revision ?? 0;
    if (typeof expectedRevision === 'number' && currentRevision !== expectedRevision) {
      throw new ValidationError(`Revision mismatch: expected ${expectedRevision}, got ${currentRevision}`);
    }

    const updated: WorkspaceItem = {
      ...current,
      ...patchCopy,
      provenance: nextProvenance,
      lifecycle: {
        ...current.lifecycle,
        ...patchCopy.lifecycle,
        updated: new Date().toISOString(),
        revision: currentRevision + 1,
      },
    };

    const next = items.slice();
    next[idx] = updated;
    await this.setItems(next);
    return updated;
  }

  async softDeleteItem(id: string): Promise<WorkspaceItem> {
    this.requireConversationId();
    const items = await this.getItems();
    const idx = items.findIndex(i => i.id === id);
    if (idx === -1) throw new NotFoundError('Item not found');

    const current = items[idx];
    const updated: WorkspaceItem = {
      ...current,
      lifecycle: {
        ...current.lifecycle,
        deleted: true,
        updated: new Date().toISOString(),
        revision: (current.lifecycle.revision ?? 0) + 1,
      },
    };

    const next = items.slice();
    next[idx] = updated;
    await this.setItems(next);
    return updated;
  }

  async hardDeleteItem(id: string): Promise<void> {
    this.requireConversationId();
    const items = await this.getItems();
    const next = items.filter(i => i.id !== id);
    await this.setItems(next);
  }

  // Note: Association is derivable by WorkspaceItem.provenance.conversationId.
  // No thread mutation is needed (or allowed) to add ad‑hoc fields.

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
    const allowed = ['utf8', 'base64', 'binary'];
    if (!allowed.includes(enc)) {
      throw new ValidationError(`Invalid encoding: ${enc}`);
    }
  }

  private validateContent(content: WorkspaceContent): void {
    if (!content || typeof content !== 'object') {
      throw new ValidationError('content is required');
    }
    if (typeof content.mimeType !== 'string' || !content.mimeType) {
      throw new ValidationError('content.mimeType is required');
    }
    if (typeof content.encoding !== 'string' || !content.encoding) {
      throw new ValidationError('content.encoding is required');
    }
    this.validateEncoding(content.encoding);
    if (typeof content.data !== 'string') {
      throw new ValidationError('content.data must be a string');
    }
  }

  private requireConversationId(): string {
    if (typeof this.conversationId === 'string' && this.conversationId) {
      return this.conversationId;
    }
    throw new ValidationError('Conversation scope is required for workspace mutation');
  }
}
