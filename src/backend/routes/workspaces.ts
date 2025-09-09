import express from 'express';
import { WorkspaceItem, ConversationThread } from '../../shared/types.js';
import logger from '../services/logger';
import { requireReq, repoGetAll, repoSetAll, ReqLike } from '../utils/repo-access';
import { errorHandler, ValidationError, NotFoundError } from '../services/error-handler';

export interface WorkspacesRoutesDeps {
  getConversations: (req?: ReqLike) => Promise<ConversationThread[]>;
  setConversations: (req: ReqLike, next: ConversationThread[]) => Promise<void>;
}

/** Update conversation workspace association. */
async function updateConversationWorkspace(
  itemId: string, 
  workspaceId: string, 
  deps: WorkspacesRoutesDeps, 
  req: ReqLike
): Promise<void> {
  const conversations = await deps.getConversations(req);
  const idx = conversations.findIndex(c => c.id === itemId);
  if (idx === -1) throw new NotFoundError('Conversation not found');
  
  const updated = { ...conversations[idx], workspaceId };
  const next = conversations.slice();
  next[idx] = updated;
  await deps.setConversations(req, next);
}

/** Permanently remove workspace item. */
async function performHardDelete(itemId: string, req: ReqLike): Promise<void> {
  const ureq = requireReq(req);
  const items = await repoGetAll<WorkspaceItem>(ureq, 'workspaceItems');
  const nextItems = items.filter(i => i.id !== itemId);
  await repoSetAll<WorkspaceItem>(ureq, 'workspaceItems', nextItems);
}

/** Mark workspace item as deleted with revision bump. */
async function performSoftDelete(itemId: string, req: ReqLike): Promise<WorkspaceItem> {
  const ureq = requireReq(req);
  const items = await repoGetAll<WorkspaceItem>(ureq, 'workspaceItems');
  const itemIdx = items.findIndex(i => i.id === itemId);
  if (itemIdx === -1) throw new NotFoundError('Item not found');
  
  const current = items[itemIdx];
  const now = new Date().toISOString();
  const nextItem: WorkspaceItem = {
    ...current,
    deleted: true,
    updated: now,
    revision: (current.revision ?? 0) + 1,
  };
  
  const nextItems = items.slice();
  nextItems[itemIdx] = nextItem;
  await repoSetAll<WorkspaceItem>(ureq, 'workspaceItems', nextItems);
  return nextItem;
}

export default function registerWorkspacesRoutes(app: express.Express, deps: WorkspacesRoutesDeps) {
  // List all workspace items
  app.get('/api/workspaces/:id/items', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const includeDeleted = String(req.query.includeDeleted || 'false').toLowerCase() === 'true';
    const ureq = requireReq(req as ReqLike);
    const items = await repoGetAll<WorkspaceItem>(ureq, 'workspaceItems');
    res.json(includeDeleted ? items : items.filter(i => !i.deleted));
  }));

  app.get('/api/workspaces/:id/items/:itemId', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const { itemId } = req.params as { id: string; itemId: string };
    const ureq = requireReq(req as ReqLike);
    const items = await repoGetAll<WorkspaceItem>(ureq, 'workspaceItems');
    const item = items.find(i => i.id === itemId);
    if (!item) throw new NotFoundError('Item not found');
    res.json(item);
  }));

  app.put('/api/workspaces/:id/items/:itemId', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const { itemId } = req.params as { id: string; itemId: string };
    const expectedRevision = typeof req.body?.expectedRevision === 'number' ? (req.body.expectedRevision as number) : undefined;
    const { label, description, tags, mimeType, encoding, data } = req.body as { label?: string; description?: string; tags?: string[]; mimeType?: string; encoding?: 'utf8'|'base64'|'binary'; data?: string };
    const ureq = requireReq(req as ReqLike);
    const items = await repoGetAll<WorkspaceItem>(ureq, 'workspaceItems');
    const itemIdx = items.findIndex(i => i.id === itemId);
    if (itemIdx === -1) throw new NotFoundError('Item not found');
    const current = items[itemIdx];
    const currentRevision = current.revision ?? 0;
    if (typeof expectedRevision === 'number' && currentRevision !== expectedRevision) {
      throw new ValidationError(`Revision conflict (current=${currentRevision})`);
    }
    // Lightweight validations on provided fields
    if (typeof encoding !== 'undefined' && !['utf8','base64','binary'].includes(encoding)) {
      throw new ValidationError(`Invalid encoding: ${encoding}`);
    }
    const now = new Date().toISOString();
    const partial: Partial<WorkspaceItem> = {
      ...(typeof label !== 'undefined' ? { label } : {}),
      ...(typeof description !== 'undefined' ? { description } : {}),
      ...(Array.isArray(tags) ? { tags } : {}),
      ...(typeof mimeType !== 'undefined' ? { mimeType } : {}),
      ...(typeof encoding !== 'undefined' ? { encoding } : {}),
      ...(typeof data !== 'undefined' ? { data } : {}),
    };
    const nextItem: WorkspaceItem = {
      ...current,
      ...partial,
      updated: now,
      revision: (current.revision ?? 0) + 1,
    };
    const nextItems = items.slice();
    nextItems[itemIdx] = nextItem;
    await repoSetAll<WorkspaceItem>(ureq, 'workspaceItems', nextItems);
    logger.info('PUT /api/workspaces/:id/items/:itemId updated', { itemId, revision: nextItem.revision });
    res.json({ success: true, item: nextItem });
  }));

  app.delete('/api/workspaces/:id/items/:itemId', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const { itemId } = req.params as { id: string; itemId: string };
    const isHardDelete = String(req.query.hard).toLowerCase() === 'true';
    
    await updateConversationWorkspace(itemId, req.params.id, deps, req as ReqLike);
    
    if (isHardDelete) {
      await performHardDelete(itemId, req as ReqLike);
      logger.info('DELETE /api/workspaces/:id/items/:itemId removed', { itemId, hard: true });
      res.json({ success: true });
    } else {
      const updatedItem = await performSoftDelete(itemId, req as ReqLike);
      logger.info('DELETE /api/workspaces/:id/items/:itemId soft-deleted', { itemId, hard: false, revision: updatedItem.revision });
      res.json({ success: true, item: updatedItem });
    }
  }));
}


