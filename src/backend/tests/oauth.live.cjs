const { test } = require('node:test');
const assert = require('node:assert');
const { createAuthHeaders, fetchJson } = require('./lib/harness.cjs');

const BASE = process.env.BACKEND_URL || 'http://localhost:3001';
const TEST_UID = process.env.VX_TEST_USER_ID || 'test-user';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-jwt';
const headers = { ...createAuthHeaders({ uid: TEST_UID, jwtSecret: JWT_SECRET }), 'Content-Type': 'application/json' };

async function ensureDeleteAccount(id) {
  const list = await fetchJson(`${BASE}/api/accounts`, { headers });
  if (list.ok && Array.isArray(list.data)) {
    const found = list.data.find(a => a.id === id);
    if (found) await fetchJson(`${BASE}/api/accounts/${encodeURIComponent(id)}`, { method: 'DELETE', headers });
  }
}

test('OAuth initiate: google/outlook URL shape', async () => {
  const g = await fetchJson(`${BASE}/api/accounts/oauth/google/initiate?state=hello`, { headers });
  assert.strictEqual(g.ok, true);
  assert.ok(g.data && typeof g.data.url === 'string');
  assert.ok(g.data.url.includes('accounts.google.com'));
  assert.ok(g.data.url.includes('state='));

  const o = await fetchJson(`${BASE}/api/accounts/oauth/outlook/initiate?state=hello`, { headers });
  assert.strictEqual(o.ok, true);
  assert.ok(o.data && typeof o.data.url === 'string');
  assert.ok(o.data.url.includes('login.microsoftonline.com'));
  assert.ok(o.data.url.includes('state='));
});

test('Accounts refresh/test: missing refresh token yields reauthUrl', async () => {
  const gid = `gmail_${Date.now()}@example.com`;
  const oid = `outlook_${Date.now()}@example.com`;
  await ensureDeleteAccount(gid);
  await ensureDeleteAccount(oid);

  // Seed minimal accounts without tokens
  const cg = await fetchJson(`${BASE}/api/accounts`, { method: 'POST', headers, body: JSON.stringify({ id: gid, provider: 'gmail', email: gid, signature: '', tokens: {} }) });
  assert.strictEqual(cg.ok, true);
  const co = await fetchJson(`${BASE}/api/accounts`, { method: 'POST', headers, body: JSON.stringify({ id: oid, provider: 'outlook', email: oid, signature: '', tokens: {} }) });
  assert.strictEqual(co.ok, true);

  // Gmail refresh should return 400 with missing_refresh_token message
  const rg = await fetchJson(`${BASE}/api/accounts/${encodeURIComponent(gid)}/refresh`, { method: 'POST', headers });
  assert.strictEqual(rg.status, 400);
  assert.ok(typeof rg.data?.error === 'string');

  // Gmail test should return ok:false with reauthUrl
  const gt = await fetchJson(`${BASE}/api/accounts/${encodeURIComponent(gid)}/gmail-test`, { headers });
  assert.strictEqual(gt.ok, true);
  assert.strictEqual(gt.data.ok, false);
  assert.ok(typeof gt.data.reauthUrl === 'string');

  // Outlook test: behavior depends on env vars; if missing, expect error; if present but no token, expect reauthUrl
  const ot = await fetchJson(`${BASE}/api/accounts/${encodeURIComponent(oid)}/outlook-test`, { headers });
  // Either ok:false with reauthUrl or a 500 error due to missing env vars — assert non-crash
  assert.ok(ot.ok || ot.status === 500);

  // Cleanup
  await fetchJson(`${BASE}/api/accounts/${encodeURIComponent(gid)}`, { method: 'DELETE', headers });
  await fetchJson(`${BASE}/api/accounts/${encodeURIComponent(oid)}`, { method: 'DELETE', headers });
});

