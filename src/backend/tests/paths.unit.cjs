const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function loadPathsFresh() {
  const p = path.join(__dirname, '..', 'dist', 'backend', 'utils', 'paths.js');
  delete require.cache[require.resolve(p)];
  return require(p);
}

test('paths: validateUid accepts and rejects correctly', () => {
  const { validateUid } = loadPathsFresh();
  assert.strictEqual(validateUid('abc'), true);
  assert.strictEqual(validateUid('google:123456'), true);
  assert.strictEqual(validateUid('A_B-9'), true);
  assert.strictEqual(validateUid(''), false);
  assert.strictEqual(validateUid('a:b:c'), false);
  assert.strictEqual(validateUid('x'.repeat(97)), false);
});

test('paths: userPaths creates safe structure under data dir', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vxmailagent-test-'));
  process.env.VX_MAILAGENT_DATA_DIR = tmp;
  const { userPaths, validatePathSafety } = loadPathsFresh();
  const up = userPaths('google:abc');
  // All paths must live under tmp/users/google_abc
  const base = up.root;
  assert.ok(base.startsWith(tmp));
  assert.ok(fs.existsSync(base), 'user root must exist');
  assert.strictEqual(validatePathSafety(up.accounts, base), true);
  assert.strictEqual(validatePathSafety(up.logs.providerEvents, base), true);
});

