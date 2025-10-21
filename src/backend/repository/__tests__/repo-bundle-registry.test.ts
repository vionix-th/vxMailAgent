import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteConnectionFactory } from '../../storage/sqlite';
import { configureSqliteFactory, RepoBundleRegistry } from '../registry';
import { RepositoryError } from '../../services/error-handler';

void test('RepoBundleRegistry.applyDefaults rejects missing settings', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-registry-test-'));
  const dataDir = path.join(tempRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const previousDataDir = process.env.VX_MAILAGENT_DATA_DIR;
  process.env.VX_MAILAGENT_DATA_DIR = dataDir;

  const factory = new SqliteConnectionFactory();
  configureSqliteFactory(factory);
  const registry = new RepoBundleRegistry();

  try {
    await assert.rejects(
      registry.getBundle('autotest:user'),
      (error: unknown) => {
        assert.ok(error instanceof RepositoryError, 'error should be RepositoryError');
        assert.strictEqual(error.code, 'SETTINGS_NOT_INITIALIZED', 'must expose SETTINGS_NOT_INITIALIZED code');
        return true;
      }
    );
  } finally {
    registry.destroy();
    await factory.closeAll();
    if (previousDataDir === undefined) {
      delete process.env.VX_MAILAGENT_DATA_DIR;
    } else {
      process.env.VX_MAILAGENT_DATA_DIR = previousDataDir;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
