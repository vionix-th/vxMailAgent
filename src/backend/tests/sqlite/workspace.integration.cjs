const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const distBackend = path.join(__dirname, '..', '..', 'dist', 'backend');
const { initRepos, shutdownRepos } = require(path.join(distBackend, 'initRepos.js'));
const {
  getUserRepoBundle,
  repoBundleRegistry,
} = require(path.join(distBackend, 'repository', 'registry.js'));
const { WorkspaceService } = require(path.join(distBackend, 'services', 'workspace-service.js'));

function withTempDataDir(fn) {
  const originalDir = process.env.VX_MAILAGENT_DATA_DIR;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-sqlite-workspace-'));
  process.env.VX_MAILAGENT_DATA_DIR = tempDir;

  const cleanup = () => {
    const shutdown = shutdownRepos().catch(() => {});
    if (originalDir === undefined) {
      delete process.env.VX_MAILAGENT_DATA_DIR;
    } else {
      process.env.VX_MAILAGENT_DATA_DIR = originalDir;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    return shutdown;
  };

  return fn().finally(() => Promise.resolve(cleanup()));
}

test('workspace service enforces conversation invariant', async () => {
  await withTempDataDir(async () => {
    initRepos();
    const uid = `workspace-user-${Date.now()}`;
    const bundle = await getUserRepoBundle(uid);
    const conversationId = 'conv-1';
    const repo = bundle.workspaceItems;
    const service = new WorkspaceService({
      conversationId,
      getItems: () => repo.getByConversation(conversationId),
      setItems: (next) => repo.replaceForConversation(conversationId, next),
    });

    const item = await service.addItem({
      content: { mimeType: 'text/plain', encoding: 'utf8', data: 'hello' },
      metadata: { label: 'test', tags: [] },
      provenance: {
        emailId: 'email-1',
        conversationId,
        createdBy: 'director',
        creatorId: 'dir-1',
      },
    });
    assert.ok(item.id);

    await assert.rejects(
      () => service.updateItem(item.id, { provenance: { conversationId: 'other' } }),
      /conversation mismatch/i
    );

    repoBundleRegistry.removeBundle(uid);
  });
});

