import { WorkspaceItem, WorkspaceContent, WorkspaceProvenance } from '../../shared/types';
import { ValidationError, NotFoundError } from './error-handler';
import { newId } from '../utils/id';
import { WorkspaceItemInput } from '../../shared/types';
import type { WorkspaceItemsRepoInstance } from '../repository/wrappers';
import { normalizeStringTags } from '../utils/tag-normalization';

export interface WorkspaceServiceDeps {
  repo: WorkspaceItemsRepoInstance;
  conversationId: string;
  directorId?: string;
  agentId?: string;
  emailId?: string;
  createdBy?: 'director' | 'agent' | 'tool';
  toolName?: string;
  ensureConversation?: () => Promise<void>;
}

export class WorkspaceService {
  private readonly repo: WorkspaceItemsRepoInstance;
  private readonly conversationId: string;
  private readonly directorId?: string;
  private readonly agentId?: string;
  private readonly emailId?: string;
  private readonly forcedCreatedBy?: 'director' | 'agent' | 'tool';
  private readonly toolName?: string;
  private readonly ensureConversationExists: () => Promise<void>;

  constructor(deps: WorkspaceServiceDeps) {
    if (!deps || typeof deps !== 'object') {
      throw new Error('WorkspaceService requires dependencies');
    }
    this.repo = deps.repo;
    this.conversationId = deps.conversationId;
    this.directorId = deps.directorId;
    this.agentId = deps.agentId;
    this.emailId = deps.emailId;
    this.forcedCreatedBy = deps.createdBy;
    this.toolName = deps.toolName;
    this.ensureConversationExists = typeof deps.ensureConversation === 'function'
      ? deps.ensureConversation
      : async () => {};
  }

  async listItems(includeDeleted: boolean = false): Promise<WorkspaceItem[]> {
    const conversationId = this.requireConversationId();
    await this.ensureConversationExists();
    const items = await this.repo.listByConversation(conversationId);
    const list = Array.isArray(items) ? items : Array.from(items);
    return includeDeleted ? list : list.filter((i) => !i.lifecycle.deleted);
  }

  async getItem(id: string): Promise<WorkspaceItem | null> {
    this.assertId(id, 'workspace item');
    const conversationId = this.requireConversationId();
    await this.ensureConversationExists();
    const item = await this.repo.getById(id);
    if (!item) return null;
    return item.provenance?.conversationId === conversationId ? item : null;
  }

  async addItem(input: WorkspaceItemInput): Promise<WorkspaceItem> {
    this.requireConversationId();
    await this.ensureConversationExists();
    this.validateContent(input.content);
    if (!input.metadata || typeof input.metadata !== 'object' || Array.isArray(input.metadata)) {
      throw new ValidationError('metadata is required');
    }
    const hasTags = Object.prototype.hasOwnProperty.call(input.metadata, 'tags');
    const normalizedTags = hasTags
      ? normalizeStringTags((input.metadata as any).tags, 'metadata.tags', {
          optional: false,
          skipEmpty: false,
          allowEmptyResult: true,
          fieldLabel: 'metadata.tags',
        })
      : [];
    const nowIso = () => new Date().toISOString();
    const item: WorkspaceItem = {
      id: newId(),
      content: input.content,
      metadata: {
        ...(typeof input.metadata.label !== 'undefined' ? { label: input.metadata.label } : {}),
        ...(typeof input.metadata.description !== 'undefined' ? { description: input.metadata.description } : {}),
        tags: normalizedTags,
      },
      provenance: this.buildProvenance(),
      lifecycle: {
        created: nowIso(),
        updated: nowIso(),
        deleted: false,
      },
    };

    await this.repo.insert(item);
    return item;
  }

  async updateItem(id: string, patch: Partial<WorkspaceItem>): Promise<WorkspaceItem> {
    this.assertId(id, 'workspace item');
    await this.ensureConversationExists();
    const current = await this.getItemOrThrow(id);

    const patchCopy: Partial<WorkspaceItem> = { ...patch };

    if (patchCopy.metadata && (typeof patchCopy.metadata !== 'object' || Array.isArray(patchCopy.metadata))) {
      throw new ValidationError('metadata must be an object');
    }

    const hasMetadataPatch = !!patchCopy.metadata && typeof patchCopy.metadata === 'object';
    if (hasMetadataPatch) {
      const metadataPatch = { ...(patchCopy.metadata as WorkspaceItem['metadata']) } as Record<string, unknown>;
      let normalizedTags: string[] | undefined;
      if (Object.prototype.hasOwnProperty.call(metadataPatch, 'tags')) {
        normalizedTags = normalizeStringTags(metadataPatch.tags, 'metadata.tags', {
          optional: false,
          skipEmpty: false,
          allowEmptyResult: true,
          fieldLabel: 'metadata.tags',
        });
        metadataPatch.tags = normalizedTags;
      }
      if (Object.prototype.hasOwnProperty.call(metadataPatch, 'label')) {
        const label = metadataPatch.label;
        if (label !== undefined) {
          if (typeof label !== 'string') {
            throw new ValidationError('metadata.label must be a string');
          }
          metadataPatch.label = label;
        }
      }
      if (Object.prototype.hasOwnProperty.call(metadataPatch, 'description')) {
        const description = metadataPatch.description;
        if (description !== undefined) {
          if (typeof description !== 'string') {
            throw new ValidationError('metadata.description must be a string');
          }
          metadataPatch.description = description;
        }
      }
      const mergedMetadata = {
        ...current.metadata,
        ...metadataPatch,
      } as WorkspaceItem['metadata'];
      if (Object.prototype.hasOwnProperty.call(metadataPatch, 'tags')) {
        mergedMetadata.tags = metadataPatch.tags as string[];
      }
      patchCopy.metadata = mergedMetadata;
    }

    if (patchCopy.content) {
      const nextContent: WorkspaceContent = { ...current.content, ...patchCopy.content };
      this.validateContent(nextContent);
      patchCopy.content = nextContent;
    }

    const updated: WorkspaceItem = {
      ...current,
      ...patchCopy,
      provenance: current.provenance,
      lifecycle: {
        ...current.lifecycle,
        ...patchCopy.lifecycle,
        updated: new Date().toISOString(),
      },
    };

    await this.repo.update(updated);
    return updated;
  }

  async deleteItem(id: string): Promise<void> {
    this.assertId(id, 'workspace item');
    await this.ensureConversationExists();
    const item = await this.getItemOrThrow(id);
    if (item.provenance?.conversationId !== this.conversationId) {
      throw new NotFoundError('Item not found');
    }
    const removed = await this.repo.delete(id);
    if (!removed) throw new NotFoundError('Item not found');
  }

  private async getItemOrThrow(id: string): Promise<WorkspaceItem> {
    const item = await this.getItem(id);
    if (!item) {
      throw new NotFoundError('Item not found');
    }
    return item;
  }

  private requireString(value: unknown, field: string): string {
    if (typeof value !== 'string') {
      throw new ValidationError(`${field} is required`);
    }
    const trimmed = value.trim();
    if (!trimmed) {
      throw new ValidationError(`${field} is required`);
    }
    return trimmed;
  }

  private buildProvenance(): WorkspaceProvenance {
    const createdBy = this.forcedCreatedBy || (this.agentId ? 'agent' : 'director');
    const creatorId = createdBy === 'agent'
      ? this.requireString(this.agentId, 'agentId')
      : this.requireString(this.directorId, 'directorId');
    const emailId = this.requireString(this.emailId, 'emailId');
    return {
      conversationId: this.conversationId,
      emailId,
      createdBy,
      creatorId,
      toolName: this.toolName || 'workspace_add_item',
    };
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
