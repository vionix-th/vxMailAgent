const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  discoverTestUser,
  withServer,
  createSession,
  fetchJson,
  waitFor,
} = require('../lib/harness');

const { uid } = discoverTestUser();

function authHeaders(sessionHeaders, extra = {}) {
  return { ...sessionHeaders, ...extra };
}

test('integration: workspace items via tool call + revision guards', { concurrency: false, timeout: 25000 }, async () => {
  // Force tool-call stub for this test only
  process.env.VX_TEST_FORCE_WORKSPACE_TOOLCALL = 'true';
  // Align stub agent id with provider stub default
  const stubAgentId = process.env.VX_TEST_WORKSPACE_AGENT_ID || 'int-workspace-agent';
  await withServer(async ({ baseUrl }) => {
    const { headers: sessionHeaders } = await createSession(baseUrl, uid);
    const jsonHeaders = authHeaders(sessionHeaders, { 'Content-Type': 'application/json' });

  const ids = {
    apiConfig: `int-ws-cfg-${Date.now()}`,
    agent: stubAgentId,
    director: `int-ws-director-${Date.now()}`,
    filter: `int-ws-filter-${Date.now()}`,
  };

  let fetcherTriggered = false;

  try {
    // Create stubbed ApiConfig
    const createCfg = await fetchJson(baseUrl, '/api/settings/api-configs', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ id: ids.apiConfig, name: 'WS Stub', model: 'gpt-4o-mini', apiKey: 'sk-stub', provider: 'openai' }),
    });
    assert.strictEqual(createCfg.status, 201, 'failed to create api config');

    // Choose a prompt
    const promptsRes = await fetchJson(baseUrl, '/api/prompts', { headers: sessionHeaders });
    assert.strictEqual(promptsRes.ok, true, '/api/prompts failed');
    const prompt = Array.isArray(promptsRes.data) && promptsRes.data[0];
    assert.ok(prompt && prompt.id, 'expected at least one prompt');

    // Create agent with fixed id expected by the stub
    const createAgent = await fetchJson(baseUrl, '/api/agents', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ id: ids.agent, name: 'WS Agent', type: 'openai', promptId: prompt.id, apiConfigId: ids.apiConfig, enabledOptionalTools: [] }),
    });
    assert.strictEqual(createAgent.status, 201, 'agent creation failed');

    // Create director referencing the agent and stubbed config
    const createDirector = await fetchJson(baseUrl, '/api/directors', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ id: ids.director, name: 'WS Director', agentIds: [ids.agent], promptId: prompt.id, apiConfigId: ids.apiConfig, enabledOptionalTools: [] }),
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
    const runRes = await fetchJson(baseUrl, '/api/fetcher/run', { method: 'POST', headers: jsonHeaders }, { timeoutMs: 15000 });
    assert.strictEqual(runRes.ok, true, '/api/fetcher/run failed');
    fetcherTriggered = true;

    // Find the new director thread
    const directorThread = await waitFor(async () => {
      const list = await fetchJson(baseUrl, '/api/conversations?limit=200&offset=0', { headers: sessionHeaders });
      if (!list.ok) return null;
      const items = Array.isArray(list.data?.items) ? list.data.items : [];
      return items.find((t) => t.kind === 'director' && t.directorId === ids.director) || null;
    }, { timeoutMs: 10000, intervalMs: 250 });
    assert.ok(directorThread && directorThread.id, 'director thread missing');

    // Call assistant once: the stub will emit a workspace_add_item tool_call targeting our agent id
    const assistant = await fetchJson(baseUrl, `/api/conversations/${encodeURIComponent(directorThread.id)}/assistant`, { method: 'POST', headers: jsonHeaders }, { timeoutMs: 15000 });
    assert.strictEqual(assistant.ok, true, 'assistant call should succeed with stub responses');

    // Workspace items are scoped to the agent child thread; locate it
    const agentThread = await waitFor(async () => {
      const list = await fetchJson(baseUrl, '/api/conversations?limit=200&offset=0', { headers: sessionHeaders });
      if (!list.ok) return null;
      const items = Array.isArray(list.data?.items) ? list.data.items : [];
      return items.find((t) => t.kind === 'agent' && t.parentId === directorThread.id) || null;
    }, { timeoutMs: 8000, intervalMs: 200 });
    assert.ok(agentThread && agentThread.id, 'agent child thread missing');

    // Verify a workspace item exists and can be read under the agent thread
    const listWs = await fetchJson(baseUrl, `/api/workspaces/${encodeURIComponent(agentThread.id)}/items`, { headers: sessionHeaders });
    assert.strictEqual(listWs.ok, true, 'workspace list failed');
    const items = Array.isArray(listWs.data) ? listWs.data : [];
    assert.ok(items.length >= 1, 'expected at least one workspace item');
    const item = items[0];

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
    } finally {
      try {
        if (ids.filter) await fetch(`${baseUrl}/api/filters/${encodeURIComponent(ids.filter)}`, { method: 'DELETE', headers: sessionHeaders });
        if (ids.director) await fetch(`${baseUrl}/api/directors/${encodeURIComponent(ids.director)}`, { method: 'DELETE', headers: sessionHeaders });
        if (ids.agent) await fetch(`${baseUrl}/api/agents/${encodeURIComponent(ids.agent)}`, { method: 'DELETE', headers: sessionHeaders });
        if (ids.apiConfig) await fetch(`${baseUrl}/api/settings/api-configs/${encodeURIComponent(ids.apiConfig)}`, { method: 'DELETE', headers: sessionHeaders });
        if (fetcherTriggered) await fetchJson(baseUrl, '/api/fetcher/stop', { method: 'POST', headers: jsonHeaders });
      } catch {}
    }
  });
});
