const { test } = require('node:test');
const assert = require('node:assert');
const { createAuthHeaders, fetchJson } = require('./lib/harness.cjs');

const BASE = process.env.BACKEND_URL || 'http://localhost:3001';
const TEST_UID = process.env.VX_TEST_USER_ID || 'test-user';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-jwt';
const headers = createAuthHeaders({ uid: TEST_UID, jwtSecret: JWT_SECRET });

test('Live Workspace: list invariants and 404s for missing items', async () => {
  const wid = 'w-test';
  const items = await fetchJson(`${BASE}/api/workspaces/${wid}/items`, { headers });
  assert.strictEqual(items.ok, true);
  assert.ok(Array.isArray(items.data));

  const itemsAll = await fetchJson(`${BASE}/api/workspaces/${wid}/items?includeDeleted=true`, { headers });
  assert.strictEqual(itemsAll.ok, true);
  assert.ok(Array.isArray(itemsAll.data));

  const missingId = 'does-not-exist';
  const getMissing = await fetchJson(`${BASE}/api/workspaces/${wid}/items/${missingId}`, { headers });
  assert.strictEqual(getMissing.status, 404);

  const putMissing = await fetchJson(`${BASE}/api/workspaces/${wid}/items/${missingId}`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'x', expectedRevision: 0 })
  });
  assert.strictEqual(putMissing.status, 404);

  const delMissing = await fetchJson(`${BASE}/api/workspaces/${wid}/items/${missingId}`, { method: 'DELETE', headers });
  // May return 404 due to not found
  assert.strictEqual(delMissing.status, 404);
});

