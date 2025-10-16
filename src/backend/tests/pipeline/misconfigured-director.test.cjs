const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  discoverTestUser,
  startBackend,
  createSession,
  fetchJson,
} = require('../lib/harness');

const { uid } = discoverTestUser();

async function cleanup(baseUrl, headers, { directorId, filterId }) {
  if (filterId) {
    try {
      await fetchJson(baseUrl, `/api/filters/${encodeURIComponent(filterId)}`, { method: 'DELETE', headers });
    } catch (error) {
      console.warn('[misconfigured-director] failed to delete filter during cleanup', error);
    }
  }
  if (directorId) {
    try {
      await fetchJson(baseUrl, `/api/directors/${encodeURIComponent(directorId)}`, { method: 'DELETE', headers });
    } catch (error) {
      console.warn('[misconfigured-director] failed to delete director during cleanup', error);
    }
  }
}

test('misconfigured director surfaces a single fetcher log error', { concurrency: false, timeout: 15000 }, async () => {
  const { baseUrl, stop } = await startBackend();
  const { headers: sessionHeaders } = await createSession(baseUrl, uid);
  const authHeaders = (extra = {}) => ({ ...sessionHeaders, ...extra });
  const directorId = `test-director-${Date.now()}`;
  const filterId = `test-filter-${Date.now()}`;
  let fetcherTriggered = false;
  let directorCreated = false;
  let filterCreated = false;

  try {
    const accounts = await fetchJson(baseUrl, '/api/accounts', { headers: sessionHeaders });
    if (!accounts.ok) {
      throw new Error(`/api/accounts failed: ${JSON.stringify(accounts.data)}`);
    }
    if (!Array.isArray(accounts.data) || accounts.data.length === 0) {
      throw new Error('[misconfigured director test] No mail account linked to the test user — connect an account before running this test');
    }

    const createDirector = await fetchJson(baseUrl, '/api/directors', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        id: directorId,
        name: 'Misconfigured Director',
        agentIds: [],
        promptId: 'missing-prompt',
        apiConfigId: 'missing-config',
        enabledOptionalTools: [],
      }),
    });
    if (!createDirector.ok) {
      throw new Error(`/api/directors failed: ${JSON.stringify(createDirector.data)}`);
    }
    directorCreated = true;

    const createFilter = await fetchJson(baseUrl, '/api/filters', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        id: filterId,
        field: 'subject',
        regex: 'MISCONFIG TEST',
        directorId,
        duplicateAllowed: false,
      }),
    });
    if (!createFilter.ok) {
      throw new Error(`/api/filters failed: ${JSON.stringify(createFilter.data)}`);
    }
    filterCreated = true;

    const runRes = await fetchJson(baseUrl, '/api/fetcher/run', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }) });
    if (!runRes.ok) {
      throw new Error(`/api/fetcher/run failed: ${JSON.stringify(runRes.data)}`);
    }
    fetcherTriggered = true;

    const stopRes = await fetchJson(baseUrl, '/api/fetcher/stop', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }) });
    if (!stopRes.ok) {
      throw new Error(`/api/fetcher/stop failed: ${JSON.stringify(stopRes.data)}`);
    }

    const logsRes = await fetchJson(baseUrl, '/api/fetcher/logs', { headers: sessionHeaders });
    assert.strictEqual(logsRes.ok, true, '/api/fetcher/logs failed');
    const entries = Array.isArray(logsRes.data) ? logsRes.data : [];
    const match = entries.find((entry) => entry.event === 'director_config_missing' && entry.directorId === directorId);
    assert.ok(match, 'Expected director_config_missing log entry for misconfigured director');
  } finally {
    if (filterCreated || directorCreated) {
      await cleanup(baseUrl, authHeaders({ 'Content-Type': 'application/json' }), { directorId: directorCreated ? directorId : undefined, filterId: filterCreated ? filterId : undefined });
    }
    if (fetcherTriggered) {
      try {
        await fetchJson(baseUrl, '/api/fetcher/stop', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }) });
      } catch (error) {
        console.warn('[misconfigured-director] failed to stop fetcher during cleanup', error);
      }
    }
    await stop();
  }
});
