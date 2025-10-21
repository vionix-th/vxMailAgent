import { WorkspaceItem, WorkspaceContent, WorkspaceProvenance } from '../../shared/types';
import { ValidationError, NotFoundError } from './error-handler';
import { newId } from '../utils/id';
import { WorkspaceItemInput } from '../../shared/types';
import type { WorkspaceItemsRepoInstance } from '../repository/wrappers';
import { normalizeStringTags } from '../utils/tag-normalization';

export interface WorkspaceServiceDeps {
  repo: WorkspaceItemsRepoInstance;
  conversationId: string;
  ensureConversation?: () => Promise<void>;
}

export class WorkspaceService {
  private readonly repo: WorkspaceItemsRepoInstance;
  private readonly conversationId: string;
  private readonly ensureConversationExists: () => Promise<void>;

  constructor(deps: WorkspaceServiceDeps) {
    if (!deps || typeof deps !== 'object') {
      throw new Error('WorkspaceService requires dependencies');
    }
    this.repo = deps.repo;
    this.conversationId = deps.conversationId;
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
    const conversationId = this.requireConversationId();
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
    if (!input.provenance || typeof input.provenance !== 'object') {
      throw new ValidationError('provenance is required');
    }
    const provenance: any = { ...input.provenance };
    if (typeof provenance.conversationId === 'string' && provenance.conversationId !== this.conversationId) {
      throw new ValidationError('provenance.conversationId mismatch');
    }
    const validatedProv = this.validateProvenanceFields(provenance);
    provenance.emailId = validatedProv.emailId;
    provenance.createdBy = validatedProv.createdBy;
    provenance.creatorId = validatedProv.creatorId;

    const nowIso = () => new Date().toISOString();
    const item: WorkspaceItem = {
      id: newId(),
      content: input.content,
      metadata: {
        ...(typeof input.metadata.label !== 'undefined' ? { label: input.metadata.label } : {}),
        ...(typeof input.metadata.description !== 'undefined' ? { description: input.metadata.description } : {}),
        tags: normalizedTags,
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
      const mergedMetadata = {
        ...current.metadata,
        ...metadataPatch,
      } as WorkspaceItem['metadata'];
      if (Object.prototype.hasOwnProperty.call(metadataPatch, 'tags')) {
        mergedMetadata.tags = metadataPatch.tags as string[];
      }
      patchCopy.metadata = mergedMetadata;
    }

    let nextProvenance: WorkspaceItem['provenance'] = { ...current.provenance, conversationId: this.conversationId };
    if ('provenance' in patchCopy) {
      const provPatch = (patchCopy as any).provenance;
      delete (patchCopy as any).provenance;
      if (provPatch && typeof provPatch === 'object') {
        if (typeof provPatch.conversationId !== 'undefined' && provPatch.conversationId !== this.conversationId) {
          throw new ValidationError('Cannot move workspace item to a different conversation');
        }
        nextProvenance = { ...nextProvenance, ...provPatch, conversationId: this.conversationId };
        const validated = this.validateProvenanceFields(nextProvenance);
        nextProvenance.emailId = validated.emailId;
        nextProvenance.createdBy = validated.createdBy;
        nextProvenance.creatorId = validated.creatorId;
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
    await this.ensureConversationExists();
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
    await this.ensureConversationExists();
    const removed = await this.repo.delete(id);
    if (!removed) throw new NotFoundError('Item not found');
  }

  async purgeAll(): Promise<number> {
    const conversationId = this.requireConversationId();
    await this.ensureConversationExists();
    return await this.repo.deleteByConversation(conversationId);
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

  private validateProvenanceFields(provenance: Record<string, unknown> | WorkspaceProvenance): { emailId: string; createdBy: WorkspaceProvenance['createdBy']; creatorId: string } {
    const emailId = this.requireString((provenance as any).emailId, 'provenance.emailId');
    const createdByRaw = this.requireString((provenance as any).createdBy, 'provenance.createdBy');
    if (createdByRaw !== 'director' && createdByRaw !== 'agent' && createdByRaw !== 'tool') {
      throw new ValidationError('provenance.createdBy must be director, agent, or tool');
    }
    const creatorId = this.requireString((provenance as any).creatorId, 'provenance.creatorId');
    return { emailId, createdBy: createdByRaw as WorkspaceProvenance['createdBy'], creatorId };
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
