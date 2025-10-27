import { ToolCallResult } from '../../shared/types';
import { WorkspaceService } from '../services/workspace-service';
import { ValidationError } from '../services/error-handler';
import logger from '../services/logger';
import type { WorkspaceItemsRepoInstance } from '../repository/wrappers';
import { ToolHandlerRegistrar, ToolExecutionRuntime, ToolCallExecutionContext } from './types';
import { normalizeStringTags } from '../utils/tag-normalization';

export function registerWorkspaceHandlers(register: ToolHandlerRegistrar) {
  register('workspace_add_item', (runtime) => executeWorkspace('workspace_add_item', runtime, 'add'));
  register('workspace_list_items', (runtime) => executeWorkspace('workspace_list_items', runtime, 'list'));
  register('workspace_get_item', (runtime) => executeWorkspace('workspace_get_item', runtime, 'get'));
  register('workspace_update_item', (runtime) => executeWorkspace('workspace_update_item', runtime, 'update'));
  register('workspace_remove_item', (runtime) => executeWorkspace('workspace_remove_item', runtime, 'remove'));
}

async function executeWorkspace(toolName: string, runtime: ToolExecutionRuntime, action: 'add' | 'list' | 'get' | 'update' | 'remove'): Promise<ToolCallResult> {
  const result = await runtime.withTimeout(
    handleWorkspaceToolCall(
      { ...runtime.params, action },
      runtime.repos.workspaceItems,
      runtime.context?.workspace?.conversationId,
      runtime.context?.workspace
    )
  );
  return { ...result, kind: toolName };
}

async function handleWorkspaceToolCall(
  payload: any,
  workspaceRepo: WorkspaceItemsRepoInstance,
  scopedConversationId?: string,
  workspaceContext?: ToolCallExecutionContext['workspace']
): Promise<ToolCallResult> {
  logger.info('[TOOLCALL] workspace', { payload });
  try {
    const conversationId = typeof scopedConversationId === 'string' && scopedConversationId.trim().length > 0
      ? scopedConversationId.trim()
      : (typeof payload?.conversationId === 'string' && payload.conversationId.trim().length > 0
        ? payload.conversationId.trim()
        : (typeof payload?.provenance?.conversationId === 'string' ? payload.provenance.conversationId.trim() : undefined));

    if (!conversationId) {
      throw new ValidationError('workspace tools require conversation scope');
    }

    const legacyProv = payload?.provenance && typeof payload.provenance === 'object' ? payload.provenance : {};
    const createdBy: any = workspaceContext?.createdBy || legacyProv.createdBy;
    const creatorId: string | undefined = workspaceContext?.creatorId || legacyProv.creatorId;
    const emailId: string | undefined = workspaceContext?.emailId || legacyProv.emailId;
    const toolName: string | undefined = workspaceContext?.toolName || legacyProv.toolName;

    const service = new WorkspaceService({
      repo: workspaceRepo,
      conversationId,
      createdBy,
      directorId: createdBy === 'director' ? creatorId : undefined,
      agentId: createdBy === 'agent' ? creatorId : undefined,
      emailId,
      toolName,
    });
    if (payload.action === 'add') {
      const mimeType = typeof payload.mimeType === 'string' ? payload.mimeType : undefined;
      if (!mimeType) {
        throw new ValidationError('workspace_add_item: mimeType is required');
      }
      const encoding = typeof payload.encoding === 'string' ? payload.encoding : undefined;
      if (!encoding) {
        throw new ValidationError('workspace_add_item: encoding is required');
      }
      const data = typeof payload.data === 'string' ? payload.data : undefined;
      if (typeof data === 'undefined') {
        throw new ValidationError('workspace_add_item: data is required');
      }
      const hasTags = Object.prototype.hasOwnProperty.call(payload, 'tags');
      const normalizedTags = hasTags
        ? normalizeStringTags(payload.tags, 'workspace_add_item.tags', {
            optional: false,
            skipEmpty: false,
            allowEmptyResult: true,
            fieldLabel: 'workspace_add_item.tags',
          }) ?? []
        : [];

      const input = {
        content: {
          mimeType,
          encoding,
          data
        },
        metadata: {
          ...(typeof payload.label === 'string' ? { label: payload.label } : {}),
          ...(typeof payload.description === 'string' ? { description: payload.description } : {}),
          tags: normalizedTags
        },
      } as const;
      const item = await service.addItem(input as any);
      return { kind: 'workspace', success: true, result: { added: true, item } };
    } else if (payload.action === 'list') {
      const items = await service.listItems(false);
      return { kind: 'workspace', success: true, result: items };
    } else if (payload.action === 'get') {
      const item = await service.getItem(payload.id);
      if (!item) return { kind: 'workspace', success: false, result: null, error: 'Workspace item not found' };
      return { kind: 'workspace', success: true, result: item };
    } else if (payload.action === 'update') {
      const updated = await service.updateItem(payload.id, payload.patch);
      return { kind: 'workspace', success: true, result: { updated: true, item: updated } };
    } else if (payload.action === 'remove') {
      await service.deleteItem(payload.id);
      return { kind: 'workspace', success: true, result: { removed: true } };
    }
    return { kind: 'workspace', success: false, result: null, error: 'Invalid workspace action' };
  } catch (err: any) {
    if (err instanceof ValidationError) {
      logger.warn('Workspace tool validation failed', {
        error: err.message,
        payload: sanitize(payload),
        conversationId: scopedConversationId,
      });
      return {
        kind: 'workspace',
        success: false,
        result: { ok: false, error: err.message, code: err.code ?? 'WORKSPACE_VALIDATION_ERROR', received: sanitize(payload) },
        error: err.message,
      };
    }
    const message = err?.message || String(err);
    logger.error('Workspace tool execution failed', {
      error: message,
      payload: sanitize(payload),
      conversationId: scopedConversationId,
    });
    return { kind: 'workspace', success: false, result: null, error: message };
  }
}

function sanitize(obj: any) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return undefined;
  }
}
