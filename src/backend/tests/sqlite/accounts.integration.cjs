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

function withTempDataDir(fn) {
  const originalDir = process.env.VX_MAILAGENT_DATA_DIR;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-sqlite-accounts-'));
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

test('account repository enforces per-user isolation', async () => {
  await withTempDataDir(async () => {
    initRepos();

    const uidA = `accounts-user-a-${Date.now()}`;
    const uidB = `accounts-user-b-${Date.now()}`;

    const bundleA = await getUserRepoBundle(uidA);
    const bundleB = await getUserRepoBundle(uidB);

    const account = {
      id: 'acct-1',
      provider: 'gmail',
      email: 'user@example.com',
      signature: 'Thanks',
      tokens: {
        accessToken: 'at',
        refreshToken: 'rt',
        expiry: new Date().toISOString(),
      },
    };

    await bundleA.accounts.insert(account);
    const storedA = await bundleA.accounts.list();
    assert.strictEqual(storedA.length, 1);
    const storedB = await bundleB.accounts.list();
    assert.strictEqual(storedB.length, 0);

    repoBundleRegistry.removeBundle(uidA);
    repoBundleRegistry.removeBundle(uidB);
  });
});
