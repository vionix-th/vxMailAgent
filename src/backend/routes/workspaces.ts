import express from 'express';
import { WorkspaceItem, ConversationThread } from '../../shared/types.js';
import logger from '../services/logger';
import { requireReq, repoGetAll, repoSetAll, ReqLike } from '../utils/repo-access';
import { errorHandler, ValidationError, NotFoundError } from '../services/error-handler';

export interface WorkspacesRoutesDeps {
  getConversations: (req?: ReqLike) => Promise<ConversationThread[]>;
  setConversations: (req: ReqLike, next: ConversationThread[]) => Promise<void>;
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
    if (typeof expectedRevision === 'number' && (current.revision || 0) !== expectedRevision) {
      throw new ValidationError(`Revision conflict (current=${current.revision || 0})`);
    }
    // Lightweight validations on provided fields
    if (typeof encoding !== 'undefined' && !['utf8','base64','binary'].includes(encoding)) {
      throw new ValidationError(`Invalid encoding: ${encoding}`);
    }
    const now = new Date().toISOString();
    const nextItem: WorkspaceItem = {
      ...current,
      label: typeof label !== 'undefined' ? label : current.label,
      description: typeof description !== 'undefined' ? description : current.description,
      tags: Array.isArray(tags) ? tags : current.tags,
      mimeType: typeof mimeType !== 'undefined' ? mimeType : current.mimeType,
      encoding: typeof encoding !== 'undefined' ? encoding : current.encoding,
      data: typeof data !== 'undefined' ? data : (current as any).data,
      updated: now,
      revision: (current.revision || 1) + 1,
    };
    const nextItems = items.slice();
    nextItems[itemIdx] = nextItem;
    await repoSetAll<WorkspaceItem>(ureq, 'workspaceItems', nextItems);
    logger.info('PUT /api/workspaces/:id/items/:itemId updated', { itemId, revision: nextItem.revision });
    res.json({ success: true, item: nextItem });
  }));

  app.delete('/api/workspaces/:id/items/:itemId', errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const { itemId } = req.params as { id: string; itemId: string };
    const hard = String(req.query.hard || 'false').toLowerCase() === 'true';
    const conversations = await deps.getConversations(req as ReqLike);
    const idx = conversations.findIndex(c => c.id === itemId);
    if (idx === -1) throw new NotFoundError('Conversation not found');
    const updated = { ...conversations[idx], workspaceId: req.params.id };
    const next = conversations.slice();
    next[idx] = updated;
    await deps.setConversations(req as ReqLike, next);
    const ureq = requireReq(req as ReqLike);
    const items = await repoGetAll<WorkspaceItem>(ureq, 'workspaceItems');
    const itemIdx = items.findIndex(i => i.id === itemId);
    if (itemIdx === -1) throw new NotFoundError('Item not found');
    const now = new Date().toISOString();
    if (hard) {
      const nextItems = items.filter(i => i.id !== itemId);
      await repoSetAll<WorkspaceItem>(ureq, 'workspaceItems', nextItems);
      logger.info('DELETE /api/workspaces/:id/items/:itemId removed', { itemId, hard: true });
      return res.json({ success: true });
    }
    // Soft delete -> mark deleted and bump revision
    const current = items[itemIdx];
    const nextItem: WorkspaceItem = {
      ...current,
      deleted: true,
      updated: now,
      revision: (current.revision || 1) + 1,
    };
    const nextItems = items.slice();
    nextItems[itemIdx] = nextItem;
    await repoSetAll<WorkspaceItem>(ureq, 'workspaceItems', nextItems);
    logger.info('DELETE /api/workspaces/:id/items/:itemId soft-deleted', { itemId, hard: false, revision: nextItem.revision });
    res.json({ success: true, item: nextItem });
  }));
}


