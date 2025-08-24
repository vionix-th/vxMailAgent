import express from 'express';
import { ConversationThread, WorkspaceItem, WorkspaceItemInput } from '../../shared/types';
import { newId } from '../utils/id';

export interface WorkspacesRoutesDeps {
  getConversations: () => ConversationThread[];
  setConversations: (next: ConversationThread[]) => void;
}

export default function registerWorkspacesRoutes(app: express.Express, deps: WorkspacesRoutesDeps) {
  // Treat :id as the director conversation id that owns the workspace
  app.get('/api/workspaces/:id/items', (req, res) => {
    const id = req.params.id;
    const thread = deps.getConversations().find(c => c.id === id && c.kind === 'director');
    if (!thread) return res.status(404).json({ error: 'Workspace (director conversation) not found' });
    const includeDeleted = String(req.query.includeDeleted || 'false').toLowerCase() === 'true';
    const items = (thread.workspaceItems || []);
    res.json(includeDeleted ? items : items.filter(i => !i.deleted));
  });

  app.post('/api/workspaces/:id/items', (req, res) => {
    const id = req.params.id;
    const body = req.body as WorkspaceItemInput;
    const conversations = deps.getConversations();
    const threadIdx = conversations.findIndex(c => c.id === id && c.kind === 'director');
    if (threadIdx === -1) return res.status(404).json({ error: 'Workspace (director conversation) not found' });
    const t = conversations[threadIdx];
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
    const updated: ConversationThread = {
      ...t,
      workspaceItems: [...(t.workspaceItems || []), item],
      lastActiveAt: now,
    };
    const next = conversations.slice();
    next[threadIdx] = updated;
    deps.setConversations(next);
    console.log(`[${now}] POST /api/workspaces/${id}/items -> added item ${item.id}`);
    res.json({ success: true, item });
  });

  app.get('/api/workspaces/:id/items/:itemId', (req, res) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    const thread = deps.getConversations().find(c => c.id === id && c.kind === 'director');
    if (!thread) return res.status(404).json({ error: 'Workspace (director conversation) not found' });
    const item = (thread.workspaceItems || []).find(i => i.id === itemId);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  });

  app.put('/api/workspaces/:id/items/:itemId', (req, res) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    const expectedRevision = typeof req.body?.expectedRevision === 'number' ? (req.body.expectedRevision as number) : undefined;
    const { label, description, tags, mimeType, encoding, data } = req.body as { label?: string; description?: string; tags?: string[]; mimeType?: string; encoding?: 'utf8'|'base64'|'binary'; data?: string };
    const conversations = deps.getConversations();
    const idx = conversations.findIndex(c => c.id === id && c.kind === 'director');
    if (idx === -1) return res.status(404).json({ error: 'Workspace (director conversation) not found' });
    const t = conversations[idx];
    const items = t.workspaceItems || [];
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
    const nextConvs = conversations.slice();
    nextConvs[idx] = {
      ...t,
      workspaceItems: nextItems,
      lastActiveAt: now,
    };
    deps.setConversations(nextConvs);
    console.log(`[${now}] PUT /api/workspaces/${id}/items/${itemId} -> updated (rev ${nextItem.revision})`);
    res.json({ success: true, item: nextItem });
  });

  app.delete('/api/workspaces/:id/items/:itemId', (req, res) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    const hard = String(req.query.hard || 'false').toLowerCase() === 'true';
    const conversations = deps.getConversations();
    const idx = conversations.findIndex(c => c.id === id && c.kind === 'director');
    if (idx === -1) return res.status(404).json({ error: 'Workspace (director conversation) not found' });
    const t = conversations[idx];
    const items = t.workspaceItems || [];
    const itemIdx = items.findIndex(i => i.id === itemId);
    if (itemIdx === -1) return res.status(404).json({ error: 'Item not found' });
    const now = new Date().toISOString();
    if (hard) {
      const nextItems = items.filter(i => i.id !== itemId);
      const nextConvs = conversations.slice();
      nextConvs[idx] = {
        ...t,
        workspaceItems: nextItems,
        lastActiveAt: now,
      };
      deps.setConversations(nextConvs);
      console.log(`[${now}] DELETE /api/workspaces/${id}/items/${itemId}?hard=true -> removed`);
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
    const nextConvs = conversations.slice();
    nextConvs[idx] = {
      ...t,
      workspaceItems: nextItems,
      lastActiveAt: now,
    };
    deps.setConversations(nextConvs);
    console.log(`[${now}] DELETE /api/workspaces/${id}/items/${itemId} -> soft-deleted`);
    res.json({ success: true, item: nextItem });
  });
}

