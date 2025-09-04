const { test } = require('node:test');
const assert = require('node:assert');
const { createAuthHeaders, fetchJson, withHeartbeat, logEvent } = require('./lib/harness.cjs');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';
const TEST_UID = process.env.VX_TEST_USER_ID || 'test-user';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-jwt';

test('Live: backend health and auth', async () => {
  // Health (public)
  const health = await withHeartbeat(fetchJson(`${BACKEND_URL}/api/health`), 'health');
  logEvent({ type: 'step', name: 'health', ok: health.ok, status: health.status, data: health.data });
  assert.strictEqual(health.ok, true);

  // Whoami (auth)
  const headers = createAuthHeaders({ uid: TEST_UID, jwtSecret: JWT_SECRET });
  const whoami = await withHeartbeat(fetchJson(`${BACKEND_URL}/api/auth/whoami`, { headers }), 'whoami');
  logEvent({ type: 'step', name: 'whoami', ok: whoami.ok, status: whoami.status });
  assert.strictEqual(whoami.ok, true);

  // Settings (per-user)
  const settings = await withHeartbeat(fetchJson(`${BACKEND_URL}/api/settings`, { headers }), 'settings');
  logEvent({ type: 'step', name: 'settings', ok: settings.ok, status: settings.status, keys: settings.data ? Object.keys(settings.data) : [] });
  assert.strictEqual(settings.ok, true);

  // Fetcher status (quick)
  const fetcher = await withHeartbeat(fetchJson(`${BACKEND_URL}/api/fetcher/status`, { headers }), 'fetcher_status');
  logEvent({ type: 'step', name: 'fetcher_status', ok: fetcher.ok, status: fetcher.status });
  assert.strictEqual(fetcher.ok, true);

  // Summary for agents
  const summary = {
    backend: BACKEND_URL,
    user: TEST_UID,
    steps: {
      health: health.status,
      whoami: whoami.status,
      settings: settings.status,
      fetcher_status: fetcher.status
    }
  };
  console.log(`RESULT_JSON ${JSON.stringify(summary)}`);
});

