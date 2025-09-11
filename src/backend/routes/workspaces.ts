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
  const base = {
    getItems: async () => await repoGetAll<WorkspaceItem>(ureq, 'workspaceItems'),
    setItems: async (next: WorkspaceItem[]) => await repoSetAll<WorkspaceItem>(ureq, 'workspaceItems', next),
  } as const;

  if (!deps) {
    return new WorkspaceService(base as any);
  }

  const opt = {
    getConversations: async () => await deps.getConversations(ureq),
    setConversations: async (next: ConversationThread[]) => await deps.setConversations(ureq, next),
  };

  return new WorkspaceService({ ...(base as any), ...opt });
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
    const service = createWorkspaceService(req as ReqLike, deps);
    const patch: Partial<WorkspaceItem> = {};
    if (req.body.content) patch.content = req.body.content;
    if (req.body.metadata) patch.metadata = req.body.metadata;
    if (req.body.lifecycle) patch.lifecycle = req.body.lifecycle;
    const nextItem = await service.updateItem(itemId, patch, expectedRevision);
    logger.info('PUT /api/workspaces/:id/items/:itemId updated', { itemId, revision: nextItem.lifecycle.revision });
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
      logger.info('DELETE /api/workspaces/:id/items/:itemId soft-deleted', { itemId, hard: false, revision: updatedItem.lifecycle.revision });
      res.json({ success: true, item: updatedItem });
    }
  }));
}

