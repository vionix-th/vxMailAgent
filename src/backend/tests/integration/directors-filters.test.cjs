const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  discoverTestUser,
  startBackend,
  createSession,
  fetchJson,
} = require('../lib/harness');
const { runSerial } = require('./lib/serial');

const { uid } = discoverTestUser();

function authHeaders(sessionHeaders, extra = {}) {
  return { ...sessionHeaders, ...extra };
}

test('integration: directors, agents, and filters enforce update guards', { concurrency: false, timeout: 20000 }, async () => {
  await runSerial(async () => {
    const { baseUrl, stop } = await startBackend();
    const { headers: sessionHeaders } = await createSession(baseUrl, uid);
    const jsonHeaders = authHeaders(sessionHeaders, { 'Content-Type': 'application/json' });

    const ids = {
      agent: `int-agent-guard-${Date.now()}`,
      director: `int-director-guard-${Date.now()}`,
      filterA: `int-filter-guard-a-${Date.now()}`,
      filterB: `int-filter-guard-b-${Date.now()}`,
    };

    try {
      const settingsRes = await fetchJson(baseUrl, '/api/settings', { headers: sessionHeaders });
    assert.strictEqual(settingsRes.ok, true, '/api/settings failed');
    const apiConfigId = settingsRes.data.apiConfigs[0]?.id;
    assert.ok(apiConfigId, 'integration user must have at least one api config');

    const promptsRes = await fetchJson(baseUrl, '/api/prompts', { headers: sessionHeaders });
    assert.strictEqual(promptsRes.ok, true, '/api/prompts failed');
    const promptId = Array.isArray(promptsRes.data) && promptsRes.data[0]?.id;
    assert.ok(promptId, 'integration user must have at least one prompt');

    const createAgent = await fetchJson(baseUrl, '/api/agents', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        id: ids.agent,
        name: 'Guard Agent',
        type: 'openai',
        promptId,
        apiConfigId,
        enabledOptionalTools: [],
      }),
    });
    assert.strictEqual(createAgent.status, 201, 'agent creation failed');

    const invalidAgentUpdate = await fetchJson(baseUrl, `/api/agents/${encodeURIComponent(ids.agent)}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ enabledOptionalTools: ['not_a_tool'] }),
    });
    assert.strictEqual(invalidAgentUpdate.ok, true, 'invalid optional tool update should succeed with sanitization');
    assert.ok(Array.isArray(invalidAgentUpdate.data.enabledOptionalTools) && invalidAgentUpdate.data.enabledOptionalTools.length === 0, 'invalid tools should be stripped');

    const createDirector = await fetchJson(baseUrl, '/api/directors', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        id: ids.director,
        name: 'Guard Director',
        agentIds: [ids.agent],
        promptId,
        apiConfigId,
        enabledOptionalTools: [],
      }),
    });
    assert.strictEqual(createDirector.status, 201, 'director creation failed');

    const invalidDirectorUpdate = await fetchJson(baseUrl, `/api/directors/${encodeURIComponent(ids.director)}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ enabledOptionalTools: ['invalid_tool'] }),
    });
    assert.strictEqual(invalidDirectorUpdate.ok, true, 'director invalid tool update should succeed with sanitization');
    assert.ok(Array.isArray(invalidDirectorUpdate.data.enabledOptionalTools) && invalidDirectorUpdate.data.enabledOptionalTools.length === 0, 'director optional tools should be stripped');

    const createFilterA = await fetchJson(baseUrl, '/api/filters', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        id: ids.filterA,
        field: 'subject',
        regex: 'GUARD-A',
        directorId: ids.director,
        duplicateAllowed: false,
      }),
    });
    assert.strictEqual(createFilterA.status, 201, 'filter A creation failed');

    const createFilterB = await fetchJson(baseUrl, '/api/filters', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        id: ids.filterB,
        field: 'subject',
        regex: 'GUARD-B',
        directorId: ids.director,
        duplicateAllowed: false,
      }),
    });
    assert.strictEqual(createFilterB.status, 201, 'filter B creation failed');

    const invalidRegex = await fetch(`${baseUrl}/api/filters/${encodeURIComponent(ids.filterA)}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ regex: '[' }),
    });
    assert.ok(invalidRegex.status >= 400, 'invalid regex update should fail');

    const listFilters = await fetchJson(baseUrl, '/api/filters', { headers: sessionHeaders });
    assert.strictEqual(listFilters.ok, true, '/api/filters list failed');
    const ownedFilters = Array.isArray(listFilters.data)
      ? listFilters.data.filter((entry) => entry.id === ids.filterA || entry.id === ids.filterB)
      : [];
    assert.strictEqual(ownedFilters.length, 2, 'expected integration filters to exist');
    } finally {
      const cleanupIds = [ids.filterA, ids.filterB];
      for (const filterId of cleanupIds) {
        await fetch(`${baseUrl}/api/filters/${encodeURIComponent(filterId)}`, {
          method: 'DELETE',
          headers: sessionHeaders,
        }).catch(() => {});
      }
      await fetch(`${baseUrl}/api/directors/${encodeURIComponent(ids.director)}`, {
        method: 'DELETE',
        headers: sessionHeaders,
      }).catch(() => {});
      await fetch(`${baseUrl}/api/agents/${encodeURIComponent(ids.agent)}`, {
        method: 'DELETE',
        headers: sessionHeaders,
      }).catch(() => {});
      await stop();
    }
  });
});
