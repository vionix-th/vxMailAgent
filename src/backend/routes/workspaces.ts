import express from 'express';
import { WorkspaceItem, ConversationThread } from '../../shared/types.js';
import { UserRequest } from '../middleware/user-context';
import logger from '../services/logger';
import { requireReq, repoGetAll, repoSetAll } from '../utils/repo-access';

export interface WorkspacesRoutesDeps {
  getConversations: (req?: UserRequest) => ConversationThread[];
  setConversations: (req: UserRequest, next: ConversationThread[]) => void;
}

export default function registerWorkspacesRoutes(app: express.Express, deps: WorkspacesRoutesDeps) {
  // List all workspace items
  app.get('/api/workspaces/:id/items', (req, res) => {
    const includeDeleted = String(req.query.includeDeleted || 'false').toLowerCase() === 'true';
    const ureq = requireReq(req as UserRequest);
    const items = repoGetAll<WorkspaceItem>(ureq, 'workspaceItems');
    res.json(includeDeleted ? items : items.filter(i => !i.deleted));
  });

  app.get('/api/workspaces/:id/items/:itemId', (req, res) => {
    const { itemId } = req.params as { id: string; itemId: string };
    const ureq = requireReq(req as UserRequest);
    const items = repoGetAll<WorkspaceItem>(ureq, 'workspaceItems');
    const item = items.find(i => i.id === itemId);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  });

  app.put('/api/workspaces/:id/items/:itemId', (req, res) => {
    const { itemId } = req.params as { id: string; itemId: string };
    const expectedRevision = typeof req.body?.expectedRevision === 'number' ? (req.body.expectedRevision as number) : undefined;
    const { label, description, tags, mimeType, encoding, data } = req.body as { label?: string; description?: string; tags?: string[]; mimeType?: string; encoding?: 'utf8'|'base64'|'binary'; data?: string };
    const ureq = requireReq(req as UserRequest);
    const items = repoGetAll<WorkspaceItem>(ureq, 'workspaceItems');
    const itemIdx = items.findIndex(i => i.id === itemId);
    if (itemIdx === -1) return res.status(404).json({ error: 'Item not found' });
    const current = items[itemIdx];
    if (typeof expectedRevision === 'number' && (current.revision || 0) !== expectedRevision) {
      return res.status(409).json({ error: 'Revision conflict', currentRevision: current.revision || 0 });
    }
    // Lightweight validations on provided fields
    if (typeof encoding !== 'undefined' && !['utf8','base64','binary'].includes(encoding)) {
      return res.status(400).json({ error: `Invalid encoding: ${encoding}` });
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
    repoSetAll<WorkspaceItem>(ureq, 'workspaceItems', nextItems);
    logger.info('PUT /api/workspaces/:id/items/:itemId updated', { itemId, revision: nextItem.revision });
    res.json({ success: true, item: nextItem });
  });

  app.delete('/api/workspaces/:id/items/:itemId', (req, res) => {
    const { itemId } = req.params as { id: string; itemId: string };
    const hard = String(req.query.hard || 'false').toLowerCase() === 'true';
    const conversations = deps.getConversations(req as UserRequest);
    const idx = conversations.findIndex(c => c.id === itemId);
    if (idx === -1) return res.status(404).json({ error: 'Conversation not found' });
    const updated = { ...conversations[idx], workspaceId: req.params.id };
    const next = conversations.slice();
    next[idx] = updated;
    deps.setConversations(req as UserRequest, next);
    const ureq = requireReq(req as UserRequest);
    const items = repoGetAll<WorkspaceItem>(ureq, 'workspaceItems');
    const itemIdx = items.findIndex(i => i.id === itemId);
    if (itemIdx === -1) return res.status(404).json({ error: 'Item not found' });
    const now = new Date().toISOString();
    if (hard) {
      const nextItems = items.filter(i => i.id !== itemId);
      repoSetAll<WorkspaceItem>(ureq, 'workspaceItems', nextItems);
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
    repoSetAll<WorkspaceItem>(ureq, 'workspaceItems', nextItems);
    logger.info('DELETE /api/workspaces/:id/items/:itemId soft-deleted', { itemId, hard: false, revision: nextItem.revision });
    res.json({ success: true, item: nextItem });
  });
}

