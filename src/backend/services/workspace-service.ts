import { WorkspaceItem, WorkspaceContent } from '../../shared/types';
import { ValidationError, NotFoundError } from './error-handler';
import { newId } from '../utils/id';
import { WorkspaceItemInput } from '../../shared/types';
import type { WorkspaceItemsRepoInstance } from '../repository/wrappers';

export interface WorkspaceServiceDeps {
  repo: WorkspaceItemsRepoInstance;
  conversationId: string;
}

export class WorkspaceService {
  private readonly repo: WorkspaceItemsRepoInstance;
  private readonly conversationId: string;

  constructor(deps: WorkspaceServiceDeps) {
    if (!deps || typeof deps !== 'object') {
      throw new Error('WorkspaceService requires dependencies');
    }
    this.repo = deps.repo;
    this.conversationId = deps.conversationId;
  }

  async listItems(includeDeleted: boolean = false): Promise<WorkspaceItem[]> {
    const conversationId = this.requireConversationId();
    const items = await this.repo.listByConversation(conversationId);
    const list = Array.isArray(items) ? items : Array.from(items);
    return includeDeleted ? list : list.filter((i) => !i.lifecycle.deleted);
  }

  async getItem(id: string): Promise<WorkspaceItem | null> {
    this.assertId(id, 'workspace item');
    const conversationId = this.requireConversationId();
    const item = await this.repo.getById(id);
    if (!item) return null;
    return item.provenance?.conversationId === conversationId ? item : null;
  }

  async addItem(input: WorkspaceItemInput): Promise<WorkspaceItem> {
    const conversationId = this.requireConversationId();
    this.validateContent(input.content);
    if (!input.metadata || typeof input.metadata !== 'object') {
      throw new ValidationError('metadata is required');
    }
    const tagsAny = (input as any)?.metadata?.tags;
    if (typeof tagsAny !== 'undefined' && !Array.isArray(tagsAny)) {
      throw new ValidationError('metadata.tags must be an array of strings');
    }
    if (!input.provenance || typeof input.provenance !== 'object') {
      throw new ValidationError('provenance is required');
    }
    const provenance: any = { ...input.provenance };
    if (typeof provenance.conversationId === 'string' && provenance.conversationId !== this.conversationId) {
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
      provenance: { ...provenance, conversationId },
      lifecycle: {
        created: nowIso(),
        updated: nowIso(),
        revision: 1,
        deleted: false,
      },
    };

    await this.repo.insert(item);
    return item;
  }

  async updateItem(id: string, patch: Partial<WorkspaceItem>, expectedRevision?: number): Promise<WorkspaceItem> {
    this.assertId(id, 'workspace item');
    const current = await this.getItemOrThrow(id);

    const pTags = (patch as any)?.metadata?.tags;
    if (typeof pTags !== 'undefined' && !Array.isArray(pTags)) {
      throw new ValidationError('metadata.tags must be an array of strings');
    }

    const patchCopy: Partial<WorkspaceItem> = { ...patch };
    let nextProvenance: WorkspaceItem['provenance'] = { ...current.provenance, conversationId: this.conversationId };
    if ('provenance' in patchCopy) {
      const provPatch = (patchCopy as any).provenance;
      delete (patchCopy as any).provenance;
      if (provPatch && typeof provPatch === 'object') {
        if (typeof provPatch.conversationId !== 'undefined' && provPatch.conversationId !== this.conversationId) {
          throw new ValidationError('Cannot move workspace item to a different conversation');
        }
        nextProvenance = { ...nextProvenance, ...provPatch, conversationId: this.conversationId };
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

    await this.repo.update(updated);
    return updated;
  }

  async softDeleteItem(id: string): Promise<WorkspaceItem> {
    this.assertId(id, 'workspace item');
    const current = await this.getItemOrThrow(id);
    const updated: WorkspaceItem = {
      ...current,
      lifecycle: {
        ...current.lifecycle,
        deleted: true,
        updated: new Date().toISOString(),
        revision: (current.lifecycle.revision ?? 0) + 1,
      },
    };
    await this.repo.update(updated);
    return updated;
  }

  async hardDeleteItem(id: string): Promise<void> {
    this.assertId(id, 'workspace item');
    const removed = await this.repo.delete(id);
    if (!removed) throw new NotFoundError('Item not found');
  }

  async purgeAll(): Promise<number> {
    const conversationId = this.requireConversationId();
    return await this.repo.deleteByConversation(conversationId);
  }

  private async getItemOrThrow(id: string): Promise<WorkspaceItem> {
    const item = await this.getItem(id);
    if (!item) {
      throw new NotFoundError('Item not found');
    }
    return item;
  }

  private validateContent(content: WorkspaceContent): void {
    if (!content || typeof content !== 'object') {
      throw new ValidationError('content is required');
    }
    if (typeof content.mimeType !== 'string' || !content.mimeType.trim()) {
      throw new ValidationError('content.mimeType is required');
    }
    this.validateEncoding(content.encoding);
    if (typeof content.data !== 'string') {
      throw new ValidationError('content.data must be a string');
    }
  }

  private validateEncoding(enc: any): void {
    const allowed = ['utf8', 'base64', 'binary'];
    if (!allowed.includes(enc)) {
      throw new ValidationError(`encoding must be one of ${allowed.join(', ')}`);
    }
  }

  private assertId(value: string, label: string): void {
    if (typeof value !== 'string' || !value.trim()) {
      throw new ValidationError(`${label} id is required`);
    }
  }

  private requireConversationId(): string {
    if (typeof this.conversationId !== 'string' || !this.conversationId.trim()) {
      throw new ValidationError('conversationId required');
    }
    return this.conversationId;
  }
}
