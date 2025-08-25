import express from 'express';
import { ConversationThread, WorkspaceItem, WorkspaceItemInput } from '../../shared/types';
import { newId } from '../utils/id';
import { Repository } from '../repository/core';

export interface WorkspacesRoutesDeps {
  getConversations: () => ConversationThread[];
  setConversations: (next: ConversationThread[]) => void;
  workspaceRepo: Repository<WorkspaceItem>;
}

export default function registerWorkspacesRoutes(app: express.Express, deps: WorkspacesRoutesDeps) {
  // List all workspace items
  app.get('/api/workspaces/:id/items', (req, res) => {
    const includeDeleted = String(req.query.includeDeleted || 'false').toLowerCase() === 'true';
    const items = deps.workspaceRepo.getAll();
    res.json(includeDeleted ? items : items.filter(i => !i.deleted));
  });

  app.post('/api/workspaces/:id/items', (req, res) => {
    const body = req.body as WorkspaceItemInput;
    // Lightweight validation (non-prescriptive, guard commons)
    const enc = body.encoding as any;
    if (typeof enc !== 'undefined' && !['utf8','base64','binary'].includes(enc)) {
      return res.status(400).json({ error: `Invalid encoding: ${enc}` });
    }
    const now = new Date().toISOString();
    const item: WorkspaceItem = {
      id: newId(),
      label: typeof body.label !== 'undefined' ? body.label : undefined,
      description: typeof body.description !== 'undefined' ? body.description : undefined,
      mimeType: typeof body.mimeType !== 'undefined' ? body.mimeType : undefined,
      encoding: typeof body.encoding !== 'undefined' ? body.encoding : undefined,
      data: typeof body.data !== 'undefined' ? body.data : undefined,
      provenance: { by: 'director' },
      tags: Array.isArray(body.tags) ? body.tags : [],
      created: now,
      updated: now,
      revision: 1,
    };
    const current = deps.workspaceRepo.getAll();
    deps.workspaceRepo.setAll([...current, item]);
    console.log(`[${now}] POST /api/workspaces/items -> added item ${item.id}`);
    res.json({ success: true, item });
  });

  app.get('/api/workspaces/:id/items/:itemId', (req, res) => {
    const { itemId } = req.params as { id: string; itemId: string };
    const items = deps.workspaceRepo.getAll();
    const item = items.find(i => i.id === itemId);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  });

  app.put('/api/workspaces/:id/items/:itemId', (req, res) => {
    const { itemId } = req.params as { id: string; itemId: string };
    const expectedRevision = typeof req.body?.expectedRevision === 'number' ? (req.body.expectedRevision as number) : undefined;
    const { label, description, tags, mimeType, encoding, data } = req.body as { label?: string; description?: string; tags?: string[]; mimeType?: string; encoding?: 'utf8'|'base64'|'binary'; data?: string };
    const items = deps.workspaceRepo.getAll();
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
    deps.workspaceRepo.setAll(nextItems);
    console.log(`[${now}] PUT /api/workspaces/items/${itemId} -> updated (rev ${nextItem.revision})`);
    res.json({ success: true, item: nextItem });
  });

  app.delete('/api/workspaces/:id/items/:itemId', (req, res) => {
    const { itemId } = req.params as { id: string; itemId: string };
    const hard = String(req.query.hard || 'false').toLowerCase() === 'true';
    const items = deps.workspaceRepo.getAll();
    const itemIdx = items.findIndex(i => i.id === itemId);
    if (itemIdx === -1) return res.status(404).json({ error: 'Item not found' });
    const now = new Date().toISOString();
    if (hard) {
      const nextItems = items.filter(i => i.id !== itemId);
      deps.workspaceRepo.setAll(nextItems);
      console.log(`[${now}] DELETE /api/workspaces/items/${itemId}?hard=true -> removed`);
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
    deps.workspaceRepo.setAll(nextItems);
    console.log(`[${now}] DELETE /api/workspaces/items/${itemId} -> soft-deleted`);
    res.json({ success: true, item: nextItem });
  });
}

