const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  discoverTestUser,
  startBackend,
  createSession,
  fetchJson,
} = require('../lib/harness');

// Acceptance: assumes fetcher routes are enabled for the `.testuser` and conversations may be absent.
const { uid } = discoverTestUser();

function authHeaders(sessionHeaders, extra = {}) {
  return { ...sessionHeaders, ...extra };
}

test('integration: fetcher controls and observability endpoints', { concurrency: false, timeout: 20000 }, async () => {
  const { baseUrl, stop } = await startBackend();
  const { headers: sessionHeaders } = await createSession(baseUrl, uid);
  const jsonHeaders = authHeaders(sessionHeaders, { 'Content-Type': 'application/json' });

  try {
    const statusRes = await fetchJson(baseUrl, '/api/fetcher/status', { headers: sessionHeaders });
    assert.strictEqual(statusRes.ok, true, `/api/fetcher/status failed: ${JSON.stringify(statusRes.data)}`);
    assert.ok(typeof statusRes.data?.active === 'boolean', 'fetcher status must return active boolean');

    const runRes = await fetchJson(baseUrl, '/api/fetcher/run', { method: 'POST', headers: jsonHeaders }, { timeoutMs: 15000 });
    assert.strictEqual(runRes.ok, true, `/api/fetcher/run failed: ${JSON.stringify(runRes.data)}`);

    const stopRes = await fetchJson(baseUrl, '/api/fetcher/stop', { method: 'POST', headers: jsonHeaders }, { timeoutMs: 10000 });
    assert.strictEqual(stopRes.ok, true, `/api/fetcher/stop failed: ${JSON.stringify(stopRes.data)}`);

    const logsRes = await fetchJson(baseUrl, '/api/fetcher/logs', { headers: sessionHeaders });
    assert.strictEqual(logsRes.ok, true, `/api/fetcher/logs failed: ${JSON.stringify(logsRes.data)}`);
    assert.ok(Array.isArray(logsRes.data), 'fetcher logs must return an array');

    const missingDetails = await fetch(`${baseUrl}/api/conversations/nonexistent/details`, { headers: sessionHeaders });
    assert.strictEqual(missingDetails.status, 404, 'conversation details must 404 for unknown ids');
    const providerEvents = await fetchJson(baseUrl, '/api/conversations/nonexistent/provider-events', { headers: sessionHeaders });
    assert.strictEqual(providerEvents.ok, true, '/api/conversations/:id/provider-events should succeed even when empty');
    assert.ok(Array.isArray(providerEvents.data), 'provider events response must be an array');
  } finally {
    try {
      await fetchJson(baseUrl, '/api/fetcher/stop', { method: 'POST', headers: jsonHeaders }, { timeoutMs: 10000 });
    } catch (error) {
      console.warn('[integration] fetcher stop during observability cleanup failed', error);
    }
    await stop();
  }
});
