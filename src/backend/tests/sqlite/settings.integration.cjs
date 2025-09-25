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
const { serializeApiConfig } = require(path.join(distBackend, 'services', 'apiConfigSerializer.js'));

function withTempDataDir(fn) {
  const originalDir = process.env.VX_MAILAGENT_DATA_DIR;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-sqlite-settings-'));
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

test('settings validation enforces apiKey and serialization strips secret', async () => {
  await withTempDataDir(async () => {
    const liveRepos = initRepos();
    const uid = `settings-user-${Date.now()}`;
    const bundle = await getUserRepoBundle(uid);
    const req = { userContext: { uid, repos: bundle } };

    const settings = await liveRepos.getSettings(req);
    settings.apiConfigs = [{ id: 'cfg-1', name: 'Mock', model: 'gpt-4o-mini', apiKey: 'secret-key', maxCompletionTokens: 512 }];
    await bundle.settings.save(settings);

    const routeModule = require(path.join(distBackend, 'routes', 'settings.js'));
    const serialized = serializeApiConfig(settings.apiConfigs[0]);
    assert.deepEqual(serialized, { id: 'cfg-1', name: 'Mock', model: 'gpt-4o-mini', maxCompletionTokens: 512 });

    const { updateSettingsPartial } = require(path.join(distBackend, 'services', 'settings.js'));
    await assert.rejects(
      () => updateSettingsPartial(req, { apiConfigs: [{ id: 'cfg-1', name: 'Updated', apiKey: '' }] }),
      /apiKey updates are not allowed/
    );
  });
});
