const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  discoverTestUser,
  withServer,
  createSession,
  fetchJson,
} = require('../lib/harness');

const { uid } = discoverTestUser();

function authHeaders(sessionHeaders, extra = {}) {
  return { ...sessionHeaders, ...extra };
}

test('integration: orchestrator timeout surfaces diagnostics metadata', { concurrency: false, timeout: 25000 }, async () => {
  await withServer(async ({ baseUrl }) => {
    const { headers: sessionHeaders } = await createSession(baseUrl, uid);
    const jsonHeaders = authHeaders(sessionHeaders, { 'Content-Type': 'application/json' });

    await fetchJson(baseUrl, '/api/cleanup/fetcher-logs', { method: 'DELETE', headers: jsonHeaders });
    await fetchJson(baseUrl, '/api/cleanup/traces', { method: 'DELETE', headers: jsonHeaders });

    const runStart = Date.now();
    const runRes = await fetchJson(baseUrl, '/api/fetcher/run', { method: 'POST', headers: jsonHeaders }, { timeoutMs: 15000 });
    assert.strictEqual(runRes.ok, true, `/api/fetcher/run failed: ${JSON.stringify(runRes.data)}`);

    const expectedTimeout = `openai_request_timeout_${process.env.OPENAI_REQUEST_TIMEOUT_MS || '30000'}ms`;

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const logsRes = await fetchJson(baseUrl, '/api/fetcher/logs', { headers: sessionHeaders });
    assert.strictEqual(logsRes.ok, true, '/api/fetcher/logs failed');
    const orchestrationLog = (logsRes.data || []).find((entry) => {
      if (entry.event !== 'orchestration_error' || entry.detail !== expectedTimeout) return false;
      const timestamp = Date.parse(entry.timestamp || '');
      return Number.isFinite(timestamp) && timestamp >= runStart;
    });

    assert.ok(orchestrationLog, 'expected orchestration_error log with normalized timeout detail');
    assert.ok(orchestrationLog.runId, 'timeout log should include runId');
    assert.ok(orchestrationLog.directorId, 'timeout log should include directorId');
    assert.ok(orchestrationLog.threadId, 'timeout log should include threadId');

    const statusRes = await fetchJson(baseUrl, '/api/fetcher/status', { headers: sessionHeaders });
    assert.strictEqual(statusRes.ok, true, '/api/fetcher/status failed');
    const accountStatus = statusRes.data.accountStatus || {};
    const timeoutAccounts = Object.values(accountStatus).filter((state) => typeof state.lastError === 'string' && state.lastError.includes('openai_request_timeout_'));
    assert.ok(timeoutAccounts.length > 0, 'fetcher status should record timeout in lastError');

    const statsRes = await fetchJson(baseUrl, '/api/cleanup/stats', { headers: sessionHeaders });
    assert.strictEqual(statsRes.ok, true, '/api/cleanup/stats failed');
    assert.ok((statsRes.data?.traces ?? 0) > 0, 'expected trace records after timeout');

    const conversationsRes = await fetchJson(baseUrl, '/api/conversations?limit=40&offset=0', { headers: sessionHeaders });
    assert.strictEqual(conversationsRes.ok, true, '/api/conversations failed');
    const failedThreads = (conversationsRes.data?.items || []).filter((thread) => {
      if (thread.status !== 'failed') return false;
      const startedAt = Date.parse(thread.startedAt || thread.createdAt || '');
      return Number.isFinite(startedAt) && startedAt >= runStart - 1000;
    });
    assert.ok(failedThreads.length > 0, 'expected at least one failed thread recorded in conversations list');
  }, {
    env: {
      VX_TEST_DISABLE_ORCHESTRATOR: 'false',
      VX_TEST_FORCE_OPENAI_ERROR: 'timeout',
    }
  });
});
