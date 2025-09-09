import express from 'express';
import { WorkspaceItem, ConversationThread } from '../../shared/types.js';
import logger from '../services/logger';
import { requireReq, repoGetAll, repoSetAll, ReqLike } from '../utils/repo-access';
import { errorHandler, NotFoundError } from '../services/error-handler';
import { WorkspaceService } from '../services/workspace-service';

export interface WorkspacesRoutesDeps {
  getConversations: (req?: ReqLike) => Promise<ConversationThread[]>;
  setConversations: (req: ReqLike, next: ConversationThread[]) => Promise<void>;
}

function createWorkspaceService(req: ReqLike, deps?: WorkspacesRoutesDeps): WorkspaceService {
  const ureq = requireReq(req);
  return new WorkspaceService({
    getItems: async () => await repoGetAll<WorkspaceItem>(ureq, 'workspaceItems'),
    setItems: async (next: WorkspaceItem[]) => await repoSetAll<WorkspaceItem>(ureq, 'workspaceItems', next),
    getConversations: deps ? async () => await deps.getConversations(ureq) : undefined,
    setConversations: deps ? async (next: ConversationThread[]) => await deps.setConversations(ureq, next) : undefined,
  });
}

export default function registerWorkspacesRoutes(app: express.Express, deps: WorkspacesRoutesDeps) {
  // List all workspace items
  app.get('/api/workspaces/:id/items', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const includeDeleted = String(req.query.includeDeleted || 'false').toLowerCase() === 'true';
    const service = createWorkspaceService(req as ReqLike, deps);
    const items = await service.listItems(includeDeleted);
    res.json(items);
  }));

  app.get('/api/workspaces/:id/items/:itemId', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const { itemId } = req.params as { id: string; itemId: string };
    const service = createWorkspaceService(req as ReqLike, deps);
    const item = await service.getItem(itemId);
    if (!item) throw new NotFoundError('Item not found');
    res.json(item);
  }));

  app.put('/api/workspaces/:id/items/:itemId', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const { itemId } = req.params as { id: string; itemId: string };
    const expectedRevision = typeof req.body?.expectedRevision === 'number' ? (req.body.expectedRevision as number) : undefined;
    const { label, description, tags, mimeType, encoding, data } = req.body as { label?: string; description?: string; tags?: string[]; mimeType?: string; encoding?: 'utf8'|'base64'|'binary'; data?: string };
    const service = createWorkspaceService(req as ReqLike, deps);
    const patch: Partial<WorkspaceItem> = {
      ...(typeof label !== 'undefined' ? { label } : {}),
      ...(typeof description !== 'undefined' ? { description } : {}),
      ...(Array.isArray(tags) ? { tags } : {}),
      ...(typeof mimeType !== 'undefined' ? { mimeType } : {}),
      ...(typeof encoding !== 'undefined' ? { encoding } : {}),
      ...(typeof data !== 'undefined' ? { data } : {}),
    };
    const nextItem = await service.updateItem(itemId, patch, expectedRevision);
    logger.info('PUT /api/workspaces/:id/items/:itemId updated', { itemId, revision: nextItem.revision });
    res.json({ success: true, item: nextItem });
  }));

  app.delete('/api/workspaces/:id/items/:itemId', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    const isHardDelete = String(req.query.hard).toLowerCase() === 'true';
    const service = createWorkspaceService(req as ReqLike, deps);

    // Ensure the parent conversation has a workspace association equal to the workspace id
    try {
      await service.updateConversationWorkspaceAssociation(id, id);
    } catch (e) {
      // Non-fatal: association is best-effort
    }

    if (isHardDelete) {
      await service.hardDeleteItem(itemId);
      logger.info('DELETE /api/workspaces/:id/items/:itemId removed', { itemId, hard: true });
      res.json({ success: true });
    } else {
      const updatedItem = await service.softDeleteItem(itemId);
      logger.info('DELETE /api/workspaces/:id/items/:itemId soft-deleted', { itemId, hard: false, revision: updatedItem.revision });
      res.json({ success: true, item: updatedItem });
    }
  }));
}


