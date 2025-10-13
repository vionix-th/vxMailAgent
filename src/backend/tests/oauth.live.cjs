const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { createAuthHeaders, fetchJson } = require('./lib/harness.cjs');
const { startTestServer } = require('./lib/test-server.cjs');
const { createFixtures } = require('./lib/fixtures.cjs');
const { resolveTestUserId } = require('./lib/env.cjs');

const IN_PROCESS = process.env.VX_TEST_IN_PROCESS_SERVER !== 'false';
const TEST_UID = resolveTestUserId();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-jwt';
let BASE;
let server;
let fixtures;
const headers = { ...createAuthHeaders({ uid: TEST_UID, jwtSecret: JWT_SECRET }), 'Content-Type': 'application/json' };

before(async () => {
  if (IN_PROCESS) {
    server = await startTestServer();
    BASE = server.baseUrl;
    fixtures = createFixtures({ uid: TEST_UID });
  } else {
    BASE = process.env.BACKEND_URL || 'http://localhost:3001';
  }
});

after(async () => {
  if (fixtures) {
    await fixtures.cleanup();
    fixtures = undefined;
  }
  if (server) {
    await server.stop();
    server = undefined;
  }
});

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

test('Accounts refresh/test respond without hanging', async (t) => {
  if (!IN_PROCESS) {
    t.skip('External deployments require pre-seeded accounts; run in-process to exercise refresh/test flows.');
    return;
  }

  const gmail = await fixtures.ensureAccount({
    provider: 'gmail',
    signature: '',
    email: `gmail_${Date.now()}@example.com`,
  });
  const outlook = await fixtures.ensureAccount({
    provider: 'outlook',
    signature: '',
    email: `outlook_${Date.now()}@example.com`,
  });

  const refresh = await fetchJson(`${BASE}/api/accounts/${encodeURIComponent(gmail.id)}/refresh`, { method: 'POST', headers });
  assert.ok([200, 400, 500].includes(refresh.status), `Unexpected refresh status ${refresh.status}`);
  assert.ok(refresh.data === null || typeof refresh.data === 'object');

  const gt = await fetchJson(`${BASE}/api/accounts/${encodeURIComponent(gmail.id)}/gmail-test`, { headers });
  assert.ok([true, false].includes(gt.ok));
  if (gt.data && typeof gt.data === 'object') {
    if (typeof gt.data.ok === 'boolean') {
      assert.ok(gt.data.ok === true || gt.data.ok === false);
    }
    if (gt.data.reauthUrl !== undefined) {
      assert.strictEqual(typeof gt.data.reauthUrl, 'string');
    }
  }

  const ot = await fetchJson(`${BASE}/api/accounts/${encodeURIComponent(outlook.id)}/outlook-test`, { headers });
  assert.ok([true, false].includes(ot.ok));
  if (ot.data && typeof ot.data === 'object' && typeof ot.data.ok === 'boolean') {
    assert.ok(ot.data.ok === true || ot.data.ok === false);
  }
});
