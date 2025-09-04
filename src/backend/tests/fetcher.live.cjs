const { test } = require('node:test');
const assert = require('node:assert');
const { createAuthHeaders, fetchJson, withHeartbeat, logEvent } = require('./lib/harness.cjs');

const BASE = process.env.BACKEND_URL || 'http://localhost:3001';
const TEST_UID = process.env.VX_TEST_USER_ID || 'test-user';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-jwt';
const headers = createAuthHeaders({ uid: TEST_UID, jwtSecret: JWT_SECRET });
headers['Content-Type'] = 'application/json';

async function waitFor(cond, label, timeoutMs = 5000, intervalMs = 200) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await cond();
    if (ok) return true;
    await new Promise(r => setTimeout(r, intervalMs));
    process.stdout.write(`STATUS ${label}: running ${Date.now() - start}ms\n`);
  }
  return false;
}

test('Live Fetcher: stop -> start -> status -> logs', async () => {
  // Ensure stopped
  await withHeartbeat(fetchJson(`${BASE}/api/fetcher/stop`, { method: 'POST', headers }), 'fetcher_stop');
  const stopped = await waitFor(async () => {
    const s = await fetchJson(`${BASE}/api/fetcher/status`, { headers });
    return s.ok && s.data && s.data.active === false;
  }, 'fetcher_wait_stop');
  logEvent({ type: 'fetcher', stage: 'stopped', ok: stopped });
  assert.strictEqual(stopped, true, 'Fetcher did not stop');

  // Start
  const startRes = await withHeartbeat(fetchJson(`${BASE}/api/fetcher/start`, { method: 'POST', headers }), 'fetcher_start');
  assert.strictEqual(startRes.ok, true);

  const started = await waitFor(async () => {
    const s = await fetchJson(`${BASE}/api/fetcher/status`, { headers });
    return s.ok && s.data && s.data.active === true;
  }, 'fetcher_wait_start', 7000);
  logEvent({ type: 'fetcher', stage: 'started', ok: started });
  assert.strictEqual(started, true, 'Fetcher did not start');

  // Trigger a manual fetch (non-fatal if fails)
  await withHeartbeat(fetchJson(`${BASE}/api/fetcher/run`, { method: 'POST', headers }), 'fetcher_run');

  // Logs
  const logs = await fetchJson(`${BASE}/api/fetcher/logs`, { headers });
  assert.strictEqual(logs.ok, true);
  assert.ok(Array.isArray(logs.data));
  if (logs.data.length > 0 && logs.data[0].id) {
    // Try delete by id
    const del = await fetchJson(`${BASE}/api/fetcher/logs/${encodeURIComponent(logs.data[0].id)}`, { method: 'DELETE', headers });
    assert.strictEqual(del.ok, true);
  }

  // Stop again
  await withHeartbeat(fetchJson(`${BASE}/api/fetcher/stop`, { method: 'POST', headers }), 'fetcher_stop2');
  const stopped2 = await waitFor(async () => {
    const s = await fetchJson(`${BASE}/api/fetcher/status`, { headers });
    return s.ok && s.data && s.data.active === false;
  }, 'fetcher_wait_stop2');
  logEvent({ type: 'fetcher', stage: 'stopped2', ok: stopped2 });
  assert.strictEqual(stopped2, true, 'Fetcher did not stop (2)');
});

