const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  discoverTestUser,
  startBackend,
  createSession,
  fetchJson,
} = require('../lib/harness');
const { createTestEnv, TEST_TIMEOUTS } = require('../lib/testEnv');
// Acceptance: assumes fetcher routes are enabled for the `.testuser` and conversations may be absent.
const { uid } = discoverTestUser();

function authHeaders(sessionHeaders, extra = {}) {
  return { ...sessionHeaders, ...extra };
}

function userDbPath(uidValue) {
  const dataDir = process.env.VX_MAILAGENT_DATA_DIR;
  assert.ok(typeof dataDir === 'string' && dataDir, 'VX_MAILAGENT_DATA_DIR must be set during integration tests');
  const safeUid = uidValue.replace(/:/g, '_');
  return path.join(dataDir, 'users', safeUid, 'user.sqlite3');
}

function restoreSettings(dbFile, snapshot) {
  const db = new Database(dbFile);
  try {
    db.prepare(
      'REPLACE INTO settings (id, virtual_root, api_configs_json, signatures_json, fetcher_auto_start, session_timeout_minutes) VALUES (@id, @virtual_root, @api_configs_json, @signatures_json, @fetcher_auto_start, @session_timeout_minutes)'
    ).run({
      id: 1,
      virtual_root: snapshot.virtual_root,
      api_configs_json: snapshot.api_configs_json,
      signatures_json: snapshot.signatures_json,
      fetcher_auto_start: snapshot.fetcher_auto_start,
      session_timeout_minutes: snapshot.session_timeout_minutes,
    });
  } finally {
    db.close();
  }
}

test('integration: fetcher start blocked until settings provisioned', { concurrency: false, timeout: TEST_TIMEOUTS.node.standard }, async () => {
  const env = createTestEnv({
    VX_TEST_MOCK_PROVIDER: 'true',
    VX_TEST_DISABLE_ORCHESTRATOR: 'true',
  });
  const { baseUrl, stop } = await startBackend({ env });
  let jsonHeaders;
  try {
    const dbFile = userDbPath(uid);
    const db = new Database(dbFile);
    let snapshot;
    try {
      snapshot = db.prepare('SELECT * FROM settings WHERE id = 1').get();
      assert.ok(snapshot, 'expected seeded settings row to exist');
      db.prepare('DELETE FROM settings WHERE id = 1').run();
      const afterDelete = db.prepare('SELECT COUNT(1) AS count FROM settings').get();
      assert.strictEqual(afterDelete.count, 0, 'settings row should be deleted before fetcher test');
    } finally {
      db.close();
    }

    const { headers: sessionHeaders } = await createSession(baseUrl, uid);
    jsonHeaders = authHeaders(sessionHeaders, { 'Content-Type': 'application/json' });

    const startMissing = await fetchJson(baseUrl, '/api/fetcher/start', { method: 'POST', headers: jsonHeaders }, { timeoutMs: TEST_TIMEOUTS.http.long });
    assert.strictEqual(startMissing.ok, false, '/api/fetcher/start must fail when settings are missing');
    assert.strictEqual(startMissing.status, 412, 'missing settings should surface as HTTP 412');
    assert.strictEqual(startMissing.data?.code, 'SETTINGS_NOT_INITIALIZED', 'error code should indicate missing settings');
    assert.match(String(startMissing.data?.message ?? ''), /not initialized/i, 'error message should mention initialization');

    restoreSettings(dbFile, snapshot);

    const startRestored = await fetchJson(baseUrl, '/api/fetcher/start', { method: 'POST', headers: jsonHeaders }, { timeoutMs: TEST_TIMEOUTS.http.long });
    assert.strictEqual(startRestored.ok, true, '/api/fetcher/start should succeed once settings restored');
  } finally {
    try {
      if (jsonHeaders) {
        await fetchJson(baseUrl, '/api/fetcher/stop', { method: 'POST', headers: jsonHeaders }, { timeoutMs: TEST_TIMEOUTS.http.long });
      }
    } catch (error) {
      console.warn('[integration] fetcher stop cleanup after provisioning test failed', error);
    }
    await stop();
  }
});

test('integration: fetcher logs reject malformed entries', { concurrency: false, timeout: TEST_TIMEOUTS.node.standard }, async () => {
  const env = createTestEnv({
    VX_TEST_MOCK_PROVIDER: 'true',
    VX_TEST_DISABLE_ORCHESTRATOR: 'true',
  });
  const { baseUrl, stop } = await startBackend({ env });
  let jsonHeaders;
  try {
    const { headers: sessionHeaders } = await createSession(baseUrl, uid);
    jsonHeaders = authHeaders(sessionHeaders, { 'Content-Type': 'application/json' });

    const initial = await fetchJson(baseUrl, '/api/fetcher/logs', { headers: sessionHeaders });
    assert.strictEqual(initial.ok, true, 'GET /api/fetcher/logs should succeed before validation checks');
    assert.ok(Array.isArray(initial.data), 'fetcher logs response must be an array');
    const baselineCount = initial.data.length;

    const nonArray = await fetchJson(baseUrl, '/api/fetcher/logs', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ entries: {} }),
    });
    assert.strictEqual(nonArray.ok, false, 'non-array payload must be rejected');
    assert.strictEqual(nonArray.status, 400, 'non-array payload should return HTTP 400');
    assert.strictEqual(nonArray.data?.code, 'FETCHER_LOG_INVALID_ARRAY', 'error code should flag invalid array');

    const afterNonArray = await fetchJson(baseUrl, '/api/fetcher/logs', { headers: sessionHeaders });
    assert.strictEqual(afterNonArray.ok, true, 'fetcher logs should still be retrievable');
    assert.ok(Array.isArray(afterNonArray.data), 'fetcher logs response must remain an array');
    assert.strictEqual(afterNonArray.data.length, baselineCount, 'failed mutation must not change stored logs');

    const missingId = await fetchJson(baseUrl, '/api/fetcher/logs', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        entries: [
          {
            timestamp: new Date().toISOString(),
            level: 'info',
            provider: null,
            accountId: 'all',
            event: 'integration_missing_id',
            message: 'missing id entry',
            emailId: null,
          },
        ],
      }),
    });
    assert.strictEqual(missingId.ok, false, 'missing id entry must be rejected');
    assert.strictEqual(missingId.status, 400, 'missing id entry should return HTTP 400');
    assert.strictEqual(missingId.data?.code, 'FETCHER_LOG_INVALID_ID', 'error code should indicate missing id');

    const afterMissingId = await fetchJson(baseUrl, '/api/fetcher/logs', { headers: sessionHeaders });
    assert.strictEqual(afterMissingId.ok, true, 'fetcher logs should still be retrievable after validation failure');
    assert.ok(Array.isArray(afterMissingId.data), 'fetcher logs response must remain an array');
    assert.strictEqual(afterMissingId.data.length, baselineCount, 'failed append must not mutate fetcher log length');
  } finally {
    try {
      if (jsonHeaders) {
        await fetchJson(baseUrl, '/api/fetcher/stop', { method: 'POST', headers: jsonHeaders }, { timeoutMs: TEST_TIMEOUTS.http.long });
      }
    } catch (error) {
      console.warn('[integration] fetcher stop cleanup after log validation test failed', error);
    }
    await stop();
  }
});

test('integration: fetcher controls and observability endpoints', { concurrency: false, timeout: TEST_TIMEOUTS.node.standard }, async () => {
  const { baseUrl, stop } = await startBackend({
    env: createTestEnv({
      VX_TEST_MOCK_PROVIDER: 'true',
      VX_TEST_DISABLE_ORCHESTRATOR: 'true',
    }),
  });
  const { headers: sessionHeaders } = await createSession(baseUrl, uid);
  const jsonHeaders = authHeaders(sessionHeaders, { 'Content-Type': 'application/json' });

  try {
      const statusRes = await fetchJson(baseUrl, '/api/fetcher/status', { headers: sessionHeaders });
      assert.strictEqual(statusRes.ok, true, `/api/fetcher/status failed: ${JSON.stringify(statusRes.data)}`);
      assert.ok(typeof statusRes.data?.active === 'boolean', 'fetcher status must return active boolean');

    const startRes = await fetchJson(baseUrl, '/api/fetcher/start', { method: 'POST', headers: jsonHeaders }, { timeoutMs: TEST_TIMEOUTS.http.long });
    assert.strictEqual(startRes.ok, true, `/api/fetcher/start failed: ${JSON.stringify(startRes.data)}`);

    const runRes = await fetchJson(baseUrl, '/api/fetcher/run', { method: 'POST', headers: jsonHeaders }, { timeoutMs: TEST_TIMEOUTS.http.fetcher });
    assert.strictEqual(runRes.ok, true, `/api/fetcher/run failed: ${JSON.stringify(runRes.data)}`);

    const fetchRes = await fetchJson(baseUrl, '/api/fetcher/fetch', { method: 'POST', headers: jsonHeaders }, { timeoutMs: TEST_TIMEOUTS.http.fetcher });
    assert.strictEqual(fetchRes.ok, true, `/api/fetcher/fetch failed: ${JSON.stringify(fetchRes.data)}`);

    const stopRes = await fetchJson(baseUrl, '/api/fetcher/stop', { method: 'POST', headers: jsonHeaders }, { timeoutMs: TEST_TIMEOUTS.http.long });
    assert.strictEqual(stopRes.ok, true, `/api/fetcher/stop failed: ${JSON.stringify(stopRes.data)}`);

    const logsRes = await fetchJson(baseUrl, '/api/fetcher/logs', { headers: sessionHeaders });
    assert.strictEqual(logsRes.ok, true, `/api/fetcher/logs failed: ${JSON.stringify(logsRes.data)}`);
    assert.ok(Array.isArray(logsRes.data), 'fetcher logs must return an array');

    if (logsRes.data.length) {
      const firstLog = logsRes.data[0];
      const deleteSingle = await fetchJson(baseUrl, `/api/fetcher/logs/${encodeURIComponent(firstLog.id)}`, {
        method: 'DELETE',
        headers: jsonHeaders,
      });
      assert.strictEqual(deleteSingle.ok, true, 'deleting single fetcher log failed');

      const bulkIds = logsRes.data.slice(1).map((entry) => entry.id).filter(Boolean);
      if (bulkIds.length) {
        const deleteMany = await fetchJson(baseUrl, '/api/fetcher/logs', {
          method: 'DELETE',
          headers: jsonHeaders,
          body: JSON.stringify({ ids: bulkIds }),
        });
        assert.strictEqual(deleteMany.ok, true, 'bulk delete of fetcher logs failed');
      }
    }

    const missingDetails = await fetch(`${baseUrl}/api/conversations/nonexistent/details`, { headers: sessionHeaders });
    assert.strictEqual(missingDetails.status, 404, 'conversation details must 404 for unknown ids');
      const providerEvents = await fetchJson(baseUrl, '/api/conversations/nonexistent/provider-events', { headers: sessionHeaders });
      assert.strictEqual(providerEvents.ok, true, '/api/conversations/:id/provider-events should succeed even when empty');
      assert.ok(Array.isArray(providerEvents.data), 'provider events response must be an array');
  } finally {
    try {
      await fetchJson(baseUrl, '/api/fetcher/stop', { method: 'POST', headers: jsonHeaders }, { timeoutMs: TEST_TIMEOUTS.http.long });
    } catch (error) {
      console.warn('[integration] fetcher stop during observability cleanup failed', error);
    }
    await stop();
  }
});
