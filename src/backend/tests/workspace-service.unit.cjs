const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

test('workspace-service: add, update, soft/hard delete, revision guard', async () => {
  const { WorkspaceService } = require(path.join(__dirname, '..', 'dist', 'backend', 'services', 'workspace-service.js'));
  const items = [];
  const repo = createMockWorkspaceRepo(items);
  const svc = new WorkspaceService({ repo, conversationId: 'c1', ensureConversation: async () => {} });
  // Add
  const added = await svc.addItem({
    content: { mimeType: 'text/plain', encoding: 'utf8', data: 'hello' },
    metadata: { tags: ['t1'] },
    provenance: { emailId: 'e1', conversationId: 'c1', createdBy: 'director', creatorId: 'd1' }
  });
  assert.ok(added.id);
  assert.strictEqual(added.lifecycle.revision, 1);
  // Update OK
  const updated = await svc.updateItem(added.id, { metadata: { label: 'L' } }, added.lifecycle.revision);
  assert.strictEqual(updated.metadata.label, 'L');
  assert.strictEqual(updated.lifecycle.revision, 2);
  // Revision mismatch
  await assert.rejects(() => svc.updateItem(added.id, { metadata: { description: 'D' } }, 1), /Revision mismatch/);
  // Soft delete
  const soft = await svc.softDeleteItem(added.id);
  assert.strictEqual(soft.lifecycle.deleted, true);
  // Hard delete
  await svc.hardDeleteItem(added.id);
  const list = await svc.listItems(true);
  assert.strictEqual(list.length, 0);
});

test('workspace-service: encoding validation', async () => {
  const { WorkspaceService } = require(path.join(__dirname, '..', 'dist', 'backend', 'services', 'workspace-service.js'));
  const items = [];
  const repo = createMockWorkspaceRepo(items);
  const svc = new WorkspaceService({ repo, conversationId: 'cx', ensureConversation: async () => {} });
  await assert.rejects(() => svc.addItem({
    content: { mimeType: 'text/plain', encoding: 'bogus', data: 'x' },
    metadata: { tags: [] },
    provenance: { emailId: 'e', conversationId: 'c', createdBy: 'director', creatorId: 'd' }
  }), /Invalid encoding/);
});

test('workspace-service: rejects when backing conversation is missing', async () => {
  const { WorkspaceService } = require(path.join(__dirname, '..', 'dist', 'backend', 'services', 'workspace-service.js'));
  const repo = createMockWorkspaceRepo([]);
  const svc = new WorkspaceService({
    repo,
    conversationId: 'missing',
    ensureConversation: async () => { throw new Error('conversation missing'); },
  });
  await assert.rejects(() => svc.listItems(), /conversation missing/);
  await assert.rejects(() => svc.addItem({
    content: { mimeType: 'text/plain', encoding: 'utf8', data: 'x' },
    metadata: { tags: [] },
    provenance: { emailId: 'e', conversationId: 'missing', createdBy: 'director', creatorId: 'd' }
  }), /conversation missing/);
});

function createMockWorkspaceRepo(store) {
  return {
    async list() {
      return store.slice();
    },
    async listByConversation(conversationId) {
      return store.filter((item) => item.provenance?.conversationId === conversationId);
    },
    async getById(id) {
      return store.find((item) => item.id === id) || null;
    },
    async insert(item) {
      store.push(item);
    },
    async update(item) {
      const idx = store.findIndex((existing) => existing.id === item.id);
      if (idx === -1) throw new Error('not found');
      store[idx] = item;
    },
    async delete(id) {
      const idx = store.findIndex((item) => item.id === id);
      if (idx === -1) return false;
      store.splice(idx, 1);
      return true;
    },
    async deleteByConversation(conversationId) {
      const before = store.length;
      for (let i = store.length - 1; i >= 0; i -= 1) {
        if (store[i]?.provenance?.conversationId === conversationId) {
          store.splice(i, 1);
        }
      }
      return before - store.length;
    },
  };
}
