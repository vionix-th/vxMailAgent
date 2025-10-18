const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  startBackend,
  createSession,
  fetchJson,
  waitFor,
} = require('../lib/harness');

const { uid } = require('../lib/harness').discoverTestUser();

function authHeaders(sessionHeaders, extra = {}) {
  return { ...sessionHeaders, ...extra };
}

test('pipeline surfaces orchestrator timeout diagnostics', { concurrency: false, timeout: 25000 }, async () => {
  const runStart = Date.now();
  const { baseUrl, stop } = await startBackend({
    env: {
      VX_TEST_DISABLE_ORCHESTRATOR: 'false',
      VX_TEST_FORCE_OPENAI_ERROR: 'timeout',
    }
  });

  const { headers: sessionHeaders } = await createSession(baseUrl, uid);
  const jsonHeaders = authHeaders(sessionHeaders, { 'Content-Type': 'application/json' });

  let fetcherTriggered = false;

  try {
    // Clear residual state to ensure we only inspect this run
    await fetchJson(baseUrl, '/api/cleanup/fetcher-logs', { method: 'DELETE', headers: jsonHeaders });
    await fetchJson(baseUrl, '/api/cleanup/traces', { method: 'DELETE', headers: jsonHeaders });

    const runRes = await fetchJson(baseUrl, '/api/fetcher/run', { method: 'POST', headers: jsonHeaders }, { timeoutMs: 15000 });
    assert.strictEqual(runRes.ok, true, `/api/fetcher/run failed: ${JSON.stringify(runRes.data)}`);
    fetcherTriggered = true;

    const expectedTimeout = `openai_request_timeout_${process.env.OPENAI_REQUEST_TIMEOUT_MS || '30000'}ms`;

    const timeoutLog = await waitFor(async () => {
      const logsRes = await fetchJson(baseUrl, '/api/fetcher/logs', { headers: sessionHeaders });
      if (!logsRes.ok || !Array.isArray(logsRes.data)) return null;
      return logsRes.data.find((entry) => {
        if (entry.event !== 'orchestration_error' || entry.detail !== expectedTimeout) return false;
        const ts = Date.parse(entry.timestamp || '');
        return Number.isFinite(ts) && ts >= runStart;
      }) || null;
    }, { timeoutMs: 12000, intervalMs: 250 });

    assert.ok(timeoutLog, 'expected orchestration_error log with normalized timeout detail');
    assert.ok(timeoutLog.runId, 'timeout log must include runId');
    assert.ok(timeoutLog.directorId, 'timeout log must include directorId');
    assert.ok(timeoutLog.threadId, 'timeout log must include threadId');

    const statusRes = await fetchJson(baseUrl, '/api/fetcher/status', { headers: sessionHeaders });
    assert.strictEqual(statusRes.ok, true, '/api/fetcher/status failed');
    const accountStatus = statusRes.data.accountStatus || {};
    const timeoutAccounts = Object.values(accountStatus).filter((state) => typeof state.lastError === 'string' && state.lastError.includes('openai_request_timeout_'));
    assert.ok(timeoutAccounts.length > 0, 'fetcher status should expose timeout via lastError');

    const statsRes = await fetchJson(baseUrl, '/api/cleanup/stats', { headers: sessionHeaders });
    assert.strictEqual(statsRes.ok, true, '/api/cleanup/stats failed');
    assert.ok((statsRes.data?.traces ?? 0) > 0, 'expected trace records captured for timeout run');

    const conversationsRes = await fetchJson(baseUrl, '/api/conversations?limit=40&offset=0', { headers: sessionHeaders });
    assert.strictEqual(conversationsRes.ok, true, '/api/conversations failed');
    const failedThreads = (conversationsRes.data?.items || []).filter((thread) => {
      if (thread.status !== 'failed') return false;
      const startedAt = Date.parse(thread.startedAt || thread.createdAt || '');
      return Number.isFinite(startedAt) && startedAt >= runStart - 1000;
    });
    assert.ok(failedThreads.length > 0, 'expected failed conversation threads recorded for this run');
  } finally {
    if (fetcherTriggered) {
      await fetchJson(baseUrl, '/api/fetcher/stop', { method: 'POST', headers: jsonHeaders }).catch(() => {});
    }
    await stop();
  }
});
