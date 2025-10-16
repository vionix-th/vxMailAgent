const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  discoverTestUser,
  startBackend,
  createSession,
  fetchJson,
} = require('../lib/harness');
// Acceptance: requires seeded prompt templates and API configs for the discovered `.testuser`.
const { uid } = discoverTestUser();

function authHeaders(sessionHeaders, extra = {}) {
  return { ...sessionHeaders, ...extra };
}

test('integration: agent/director/filter lifecycle enforces invariants', { concurrency: false, timeout: 20000 }, async () => {
  const { baseUrl, stop } = await startBackend();
  const { headers: sessionHeaders } = await createSession(baseUrl, uid);
  const jsonHeaders = authHeaders(sessionHeaders, { 'Content-Type': 'application/json' });

  const created = { agent: null, director: null, filter: null };

  try {
      const settingsRes = await fetchJson(baseUrl, '/api/settings', { headers: sessionHeaders });
    assert.strictEqual(settingsRes.ok, true, `/api/settings failed: ${JSON.stringify(settingsRes.data)}`);
    const apiConfig = Array.isArray(settingsRes.data?.apiConfigs) && settingsRes.data.apiConfigs[0];
    if (!apiConfig) {
      throw new Error('[integration] No API config available — provision at least one before running CRUD tests');
    }

    const promptsRes = await fetchJson(baseUrl, '/api/prompts', { headers: sessionHeaders });
    assert.strictEqual(promptsRes.ok, true, `/api/prompts failed: ${JSON.stringify(promptsRes.data)}`);
    const prompts = Array.isArray(promptsRes.data) ? promptsRes.data : [];
    if (!prompts.length) {
      throw new Error('[integration] No prompts available — seed a prompt template before running CRUD tests');
    }
    const prompt = prompts[0];

    const directorNegative = await fetch(`${baseUrl}/api/directors`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        id: `int-director-missing-${Date.now()}`,
        name: 'Invalid Director',
        agentIds: [],
        apiConfigId: apiConfig.id,
        enabledOptionalTools: [],
      }),
    });
    assert.ok(directorNegative.status >= 400, 'director without promptId must be rejected');

    const agentId = `int-agent-${Date.now()}`;
    const createAgent = await fetchJson(baseUrl, '/api/agents', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        id: agentId,
        name: 'Integration Agent',
        type: 'openai',
        promptId: prompt.id,
        apiConfigId: apiConfig.id,
        enabledOptionalTools: [],
      }),
    });
    assert.strictEqual(createAgent.status, 201, 'agent creation must return 201');
    created.agent = agentId;

    const updateAgent = await fetchJson(baseUrl, `/api/agents/${encodeURIComponent(agentId)}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ name: 'Integration Agent v2' }),
    });
    assert.strictEqual(updateAgent.status, 200, 'agent update must succeed');
    assert.strictEqual(updateAgent.data?.name, 'Integration Agent v2', 'agent update must persist new name');

    const directorId = `int-director-${Date.now()}`;
    const createDirector = await fetchJson(baseUrl, '/api/directors', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        id: directorId,
        name: 'Integration Director',
        agentIds: [agentId],
        promptId: prompt.id,
        apiConfigId: apiConfig.id,
        enabledOptionalTools: [],
      }),
    });
    assert.strictEqual(createDirector.status, 201, 'director creation must return 201');
    created.director = directorId;

    const badFilter = await fetch(`${baseUrl}/api/filters`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        id: `int-filter-invalid-${Date.now()}`,
        field: 'invalid',
        regex: '.*',
        directorId,
      }),
    });
    assert.ok(badFilter.status >= 400, 'filter must reject invalid field enum');

    const orphanFilter = await fetch(`${baseUrl}/api/filters`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        id: `int-filter-orphan-${Date.now()}`,
        field: 'subject',
        regex: 'ORPHAN',
        directorId: 'nonexistent-director',
      }),
    });
    assert.ok(orphanFilter.status >= 400, 'filter must fail when director reference is missing');

    const filterId = `int-filter-${Date.now()}`;
    const createFilter = await fetchJson(baseUrl, '/api/filters', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        id: filterId,
        field: 'subject',
        regex: `INTEGRATION-${Date.now()}`,
        directorId,
        duplicateAllowed: false,
      }),
    });
    assert.strictEqual(createFilter.status, 201, 'filter creation must return 201');
    created.filter = filterId;

    const listFilters = await fetchJson(baseUrl, '/api/filters', { headers: sessionHeaders });
    assert.strictEqual(listFilters.ok, true, '/api/filters list must succeed');
    const found = Array.isArray(listFilters.data) && listFilters.data.some((entry) => entry.id === filterId);
    assert.ok(found, 'newly created filter must appear in list response');
  } finally {
    if (created.filter) {
      await fetch(`${baseUrl}/api/filters/${encodeURIComponent(created.filter)}`, {
        method: 'DELETE',
        headers: sessionHeaders,
      }).catch((error) => console.warn('[integration] failed to delete filter during cleanup', error));
    }
    if (created.director) {
      await fetch(`${baseUrl}/api/directors/${encodeURIComponent(created.director)}`, {
        method: 'DELETE',
        headers: sessionHeaders,
      }).catch((error) => console.warn('[integration] failed to delete director during cleanup', error));
    }
    if (created.agent) {
      await fetch(`${baseUrl}/api/agents/${encodeURIComponent(created.agent)}`, {
        method: 'DELETE',
        headers: sessionHeaders,
      }).catch((error) => console.warn('[integration] failed to delete agent during cleanup', error));
    }
    try {
      await fetchJson(baseUrl, '/api/fetcher/stop', { method: 'POST', headers: authHeaders(sessionHeaders, { 'Content-Type': 'application/json' }) });
    } catch (error) {
      console.warn('[integration] fetcher stop during CRUD cleanup failed', error);
    }
    await stop();
  }
});
