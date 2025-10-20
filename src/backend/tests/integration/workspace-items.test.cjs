const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  discoverTestUser,
  withServer,
  createSession,
  fetchJson,
  waitFor,
} = require('../lib/harness');
const { createTestEnv, TEST_TIMEOUTS } = require('../lib/testEnv');

const { uid } = discoverTestUser();

function authHeaders(sessionHeaders, extra = {}) {
  return { ...sessionHeaders, ...extra };
}

test('integration: workspace items via tool call + revision guards', { concurrency: false, timeout: TEST_TIMEOUTS.node.extended }, async () => {
  const testEnv = createTestEnv({
    VX_TEST_MOCK_PROVIDER: 'true',
    VX_TEST_DISABLE_ORCHESTRATOR: 'true',
    VX_TEST_OPENAI_STUB: 'true',
    VX_TEST_FORCE_WORKSPACE_TOOLCALL: 'true',
  });
  const stubAgentId = testEnv.VX_TEST_WORKSPACE_AGENT_ID;
  await withServer(async ({ baseUrl }) => {
    const { headers: sessionHeaders } = await createSession(baseUrl, uid);
    const jsonHeaders = authHeaders(sessionHeaders, { 'Content-Type': 'application/json' });

  const ids = {
    directorConfig: `int-ws-dir-cfg-${Date.now()}`,
    agentConfig: `int-ws-agent-cfg-${Date.now()}`,
    agent: stubAgentId,
    director: `int-ws-director-${Date.now()}`,
    filter: `int-ws-filter-${Date.now()}`,
  };

  let fetcherTriggered = false;

  try {
    // Create stubbed ApiConfig for director
    const createDirectorCfg = await fetchJson(baseUrl, '/api/settings/api-configs', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ id: ids.directorConfig, name: 'WS Director Stub', model: 'gpt-4o-mini', apiKey: 'sk-director', provider: 'openai' }),
    });
    assert.strictEqual(createDirectorCfg.status, 201, 'failed to create director api config');

    // Create stubbed ApiConfig for agent with distinct characteristics
    const createAgentCfg = await fetchJson(baseUrl, '/api/settings/api-configs', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ id: ids.agentConfig, name: 'WS Agent Stub', model: 'gpt-agent-special', apiKey: 'sk-agent', provider: 'openai' }),
    });
    assert.strictEqual(createAgentCfg.status, 201, 'failed to create agent api config');

    // Choose a prompt
    const promptsRes = await fetchJson(baseUrl, '/api/prompts', { headers: sessionHeaders });
    assert.strictEqual(promptsRes.ok, true, '/api/prompts failed');
    const prompt = Array.isArray(promptsRes.data) && promptsRes.data[0];
    assert.ok(prompt && prompt.id, 'expected at least one prompt');

    // Create agent with fixed id expected by the stub
    const createAgent = await fetchJson(baseUrl, '/api/agents', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ id: ids.agent, name: 'WS Agent', type: 'openai', promptId: prompt.id, apiConfigId: ids.agentConfig, enabledOptionalTools: [] }),
    });
    assert.strictEqual(createAgent.status, 201, 'agent creation failed');

    // Create director referencing the agent and stubbed config
    const createDirector = await fetchJson(baseUrl, '/api/directors', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ id: ids.director, name: 'WS Director', agentIds: [ids.agent], promptId: prompt.id, apiConfigId: ids.directorConfig, enabledOptionalTools: [] }),
    });
    assert.strictEqual(createDirector.status, 201, 'director creation failed');

    // Filter that matches mock provider subject
    const createFilter = await fetchJson(baseUrl, '/api/filters', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ id: ids.filter, field: 'subject', regex: 'E2E TEST: mock provider subject', directorId: ids.director, duplicateAllowed: false }),
    });
    assert.strictEqual(createFilter.status, 201, 'filter creation failed');

    // Run fetcher → creates director thread (orchestrator disabled for email pipeline)
    const runRes = await fetchJson(baseUrl, '/api/fetcher/run', { method: 'POST', headers: jsonHeaders }, { timeoutMs: TEST_TIMEOUTS.http.fetcher });
    assert.strictEqual(runRes.ok, true, '/api/fetcher/run failed');
    fetcherTriggered = true;

    // Find the new director thread
    const directorThread = await waitFor(async () => {
      const list = await fetchJson(baseUrl, '/api/conversations?limit=200&offset=0', { headers: sessionHeaders });
      if (!list.ok) return null;
      const items = Array.isArray(list.data?.items) ? list.data.items : [];
      return items.find((t) => t.kind === 'director' && t.directorId === ids.director) || null;
    }, { timeoutMs: TEST_TIMEOUTS.wait.standard, intervalMs: 250 });
    assert.ok(directorThread && directorThread.id, 'director thread missing');

    // Call assistant once: the stub will emit a workspace_add_item tool_call targeting our agent id
    const assistant = await fetchJson(baseUrl, `/api/conversations/${encodeURIComponent(directorThread.id)}/assistant`, {
      method: 'POST',
      headers: jsonHeaders,
    }, { timeoutMs: TEST_TIMEOUTS.http.fetcher });
    assert.strictEqual(assistant.status, 504, 'assistant call should fail with conversation timeout');
    assert.strictEqual(assistant.ok, false, 'assistant timeout response must set success=false');
    assert.strictEqual(assistant.data?.code, 'CONVERSATION_TIMEOUT', 'expected conversation timeout error code');

    // Workspace items are scoped to the agent child thread; locate it
    const agentThread = await waitFor(async () => {
      const list = await fetchJson(baseUrl, '/api/conversations?limit=200&offset=0', { headers: sessionHeaders });
      if (!list.ok) return null;
      const items = Array.isArray(list.data?.items) ? list.data.items : [];
      return items.find((t) => t.kind === 'agent' && t.parentId === directorThread.id) || null;
    }, { timeoutMs: TEST_TIMEOUTS.wait.medium, intervalMs: 200 });
    assert.ok(agentThread && agentThread.id, 'agent child thread missing');

    const refreshedDirector = await fetchJson(baseUrl, `/api/conversations/${encodeURIComponent(directorThread.id)}`, { headers: sessionHeaders });
    assert.strictEqual(refreshedDirector.ok, true, 'director refresh failed');
    assert.strictEqual(refreshedDirector.data.status, 'failed', 'director thread should be marked failed after timeout');

    // Verify a workspace item exists and can be read under the agent thread
    const listWs = await fetchJson(baseUrl, `/api/workspaces/${encodeURIComponent(agentThread.id)}/items`, { headers: sessionHeaders });
    assert.strictEqual(listWs.ok, true, 'workspace list failed');
    const items = Array.isArray(listWs.data) ? listWs.data : [];
    assert.ok(items.length >= 1, 'expected at least one workspace item');
    const item = items[0];
    assert.strictEqual(item.provenance.createdBy, 'agent', 'workspace item provenance createdBy must be agent');
    assert.strictEqual(String(item.provenance.creatorId), String(ids.agent), 'workspace item provenance.creatorId must match agent id');

    // Update with expectedRevision guard (happy path)
    const rev = item.lifecycle.revision;
    const patch = await fetchJson(baseUrl, `/api/workspaces/${encodeURIComponent(agentThread.id)}/items/${encodeURIComponent(item.id)}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ expectedRevision: rev, metadata: { label: 'stub-note-updated' } }),
    });
    assert.strictEqual(patch.ok, true, 'workspace update failed');
    assert.strictEqual(patch.data.item.metadata.label, 'stub-note-updated', 'label not updated');

    // Update with stale revision (should 4xx)
    const stale = await fetch(`${baseUrl}/api/workspaces/${encodeURIComponent(agentThread.id)}/items/${encodeURIComponent(item.id)}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ expectedRevision: rev, metadata: { label: 'stale' } }),
    });
    assert.ok(stale.status >= 400, 'stale revision must fail');

    // Soft delete
    const softDel = await fetchJson(baseUrl, `/api/workspaces/${encodeURIComponent(agentThread.id)}/items/${encodeURIComponent(item.id)}`, {
      method: 'DELETE',
      headers: jsonHeaders,
    });
    assert.strictEqual(softDel.ok, true, 'soft delete failed');
    assert.strictEqual(softDel.data.item.lifecycle.deleted, true, 'item should be marked deleted');

    // Hard delete
    const hardDel = await fetchJson(baseUrl, `/api/workspaces/${encodeURIComponent(agentThread.id)}/items/${encodeURIComponent(item.id)}?hard=true`, {
      method: 'DELETE',
      headers: jsonHeaders,
    });
    assert.strictEqual(hardDel.ok, true, 'hard delete failed');

    // 404 after hard delete
    const notFound = await fetch(`${baseUrl}/api/workspaces/${encodeURIComponent(agentThread.id)}/items/${encodeURIComponent(item.id)}`, { headers: sessionHeaders });
    assert.strictEqual(notFound.status, 404, 'deleted item should 404');

    const providerEvents = await fetchJson(baseUrl, `/api/conversations/${encodeURIComponent(agentThread.id)}/provider-events`, { headers: sessionHeaders });
    assert.strictEqual(providerEvents.ok, true, 'provider events fetch should succeed');
    const requestEvent = Array.isArray(providerEvents.data) ? providerEvents.data.find((ev) => ev.type === 'request') : null;
    assert.ok(requestEvent, 'expected provider request event for agent thread');
    assert.strictEqual(requestEvent.payload?.model, 'gpt-agent-special', 'agent conversation must use the agent api config model');
    } finally {
      try {
        if (ids.filter) await fetch(`${baseUrl}/api/filters/${encodeURIComponent(ids.filter)}`, { method: 'DELETE', headers: sessionHeaders });
        if (ids.director) await fetch(`${baseUrl}/api/directors/${encodeURIComponent(ids.director)}`, { method: 'DELETE', headers: sessionHeaders });
        if (ids.agent) await fetch(`${baseUrl}/api/agents/${encodeURIComponent(ids.agent)}`, { method: 'DELETE', headers: sessionHeaders });
        if (ids.agentConfig) await fetch(`${baseUrl}/api/settings/api-configs/${encodeURIComponent(ids.agentConfig)}`, { method: 'DELETE', headers: sessionHeaders });
        if (ids.directorConfig) await fetch(`${baseUrl}/api/settings/api-configs/${encodeURIComponent(ids.directorConfig)}`, { method: 'DELETE', headers: sessionHeaders });
        if (fetcherTriggered) await fetchJson(baseUrl, '/api/fetcher/stop', { method: 'POST', headers: jsonHeaders });
      } catch {}
    }
  }, { env: testEnv });
});
