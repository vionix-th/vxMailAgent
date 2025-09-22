const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

test('workspace-service: add, update, soft/hard delete, revision guard', async () => {
  const { WorkspaceService } = require(path.join(__dirname, '..', 'dist', 'backend', 'services', 'workspace-service.js'));
  const items = [];
  const svc = new WorkspaceService({
    getItems: async () => items.slice(),
    mutateItems: async (updater) => {
      const next = await Promise.resolve(updater(items.slice()));
      items.splice(0, items.length, ...next);
      return items.slice();
    },
  });
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
  const svc = new WorkspaceService({
    getItems: async () => items.slice(),
    mutateItems: async (updater) => {
      const next = await Promise.resolve(updater(items.slice()));
      items.splice(0, items.length, ...next);
      return items.slice();
    },
  });
  await assert.rejects(() => svc.addItem({
    content: { mimeType: 'text/plain', encoding: 'bogus', data: 'x' },
    metadata: { tags: [] },
    provenance: { emailId: 'e', conversationId: 'c', createdBy: 'director', creatorId: 'd' }
  }), /Invalid encoding/);
});

