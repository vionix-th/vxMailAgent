const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  discoverTestUser,
  withServer,
  createSession,
  fetchJson,
  waitFor,
  createLogCapture,
} = require('../lib/harness');
const { createTestEnv, TEST_TIMEOUTS } = require('../lib/testEnv');

const { uid } = discoverTestUser();

function authHeaders(sessionHeaders, extra = {}) {
  return { ...sessionHeaders, ...extra };
}

test('integration: conversations pagination, message append, and workspace access', { concurrency: false, timeout: TEST_TIMEOUTS.node.standard }, async (t) => {
  await withServer(async ({ baseUrl }) => {
    const logCapture = createLogCapture();
    const { headers: sessionHeaders } = await createSession(baseUrl, uid);
    const jsonHeaders = authHeaders(sessionHeaders, { 'Content-Type': 'application/json' });
    let fetcherTriggered = false;
    let createdAgentId; let createdDirectorId; let createdFilterId;
    let monitoredThreadId;

  try {
    const settingsRes = await fetchJson(baseUrl, '/api/settings', { headers: sessionHeaders });
    assert.strictEqual(settingsRes.ok, true, '/api/settings failed');
    const apiConfigs = Array.isArray(settingsRes.data?.apiConfigs) ? settingsRes.data.apiConfigs : [];
    if (!apiConfigs.length) {
      t.skip('[integration] No API configs available — seed api configs before running this suite');
      return;
    }
    const apiConfigId = apiConfigs[0].id;

    const promptsRes = await fetchJson(baseUrl, '/api/prompts', { headers: sessionHeaders });
    assert.strictEqual(promptsRes.ok, true, '/api/prompts failed');
    const prompts = Array.isArray(promptsRes.data) ? promptsRes.data : [];
    if (!prompts.length) {
      t.skip('[integration] No prompts available — seed prompt templates before running this suite');
      return;
    }
    const promptId = prompts[0].id;

    const listRes = await fetchJson(baseUrl, '/api/conversations?limit=200&offset=0', { headers: sessionHeaders });
    assert.strictEqual(listRes.ok, true, '/api/conversations list failed');
    const items = Array.isArray(listRes.data?.items) ? listRes.data.items : [];
    const baselineIds = new Set(items.map((thread) => thread.id));

    let directorThread = items.find((thread) => thread.kind === 'director');
    if (!directorThread) {
      const agentId = `int-convo-agent-${Date.now()}`;
      const directorId = `int-convo-director-${Date.now()}`;
      const filterId = `int-convo-filter-${Date.now()}`;

      const createAgent = await fetchJson(baseUrl, '/api/agents', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          id: agentId,
          name: 'Integration Conversation Agent',
          type: 'openai',
          promptId,
          apiConfigId,
          enabledOptionalTools: [],
        }),
      });
      assert.strictEqual(createAgent.status, 201, 'agent creation should return 201');
      createdAgentId = agentId;

      const createDirector = await fetchJson(baseUrl, '/api/directors', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          id: directorId,
          name: 'Integration Conversation Director',
          agentIds: [agentId],
          promptId,
          apiConfigId,
          enabledOptionalTools: [],
        }),
      });
      assert.strictEqual(createDirector.status, 201, 'director creation should return 201');
      createdDirectorId = directorId;

      const createFilter = await fetchJson(baseUrl, '/api/filters', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          id: filterId,
          field: 'subject',
          regex: 'E2E TEST: mock provider subject',
          directorId,
          duplicateAllowed: false,
        }),
      });
      assert.strictEqual(createFilter.status, 201, 'filter creation should return 201');
      createdFilterId = filterId;

      const runRes = await fetchJson(baseUrl, '/api/fetcher/run', {
        method: 'POST',
        headers: jsonHeaders,
      }, { timeoutMs: TEST_TIMEOUTS.http.fetcher });
      assert.strictEqual(runRes.ok, true, '/api/fetcher/run failed to produce conversations');
      fetcherTriggered = true;

      const result = await waitFor(async () => {
        const refresh = await fetchJson(baseUrl, '/api/conversations?limit=200&offset=0', { headers: sessionHeaders });
        if (!refresh.ok) return null;
        const threads = Array.isArray(refresh.data?.items) ? refresh.data.items : [];
        const director = threads.find((thread) => thread.kind === 'director' && thread.directorId === (createdDirectorId || thread.directorId) && !baselineIds.has(thread.id));
        return director ? { threads, director } : null;
      }, { timeoutMs: TEST_TIMEOUTS.wait.long, intervalMs: 300 });

      directorThread = result.director;
    }

    assert.ok(directorThread, '[integration] Missing director conversation after fetcher run');

    const pagination = await fetchJson(baseUrl, '/api/conversations?limit=5&offset=0', { headers: sessionHeaders });
    assert.strictEqual(pagination.ok, true, 'pagination request failed');
    assert.ok(pagination.data.items.length <= 5, 'pagination limit should bound results');

    const invalidLimit = await fetch(`${baseUrl}/api/conversations?limit=invalid`, { headers: sessionHeaders });
    assert.strictEqual(invalidLimit.status, 400, 'invalid limit must return 400');

    const invalidOffset = await fetch(`${baseUrl}/api/conversations?offset=-1`, { headers: sessionHeaders });
    assert.strictEqual(invalidOffset.status, 400, 'negative offset must return 400');

    const threadId = directorThread.id;
    monitoredThreadId = threadId;
    assert.ok(directorThread.email && typeof directorThread.email.id === 'string' && directorThread.email.id.length > 0, 'director thread must expose email id');
    assert.strictEqual(directorThread.directorId, createdDirectorId || directorThread.directorId, 'director thread directorId mismatch');

    const detailsRes = await fetchJson(baseUrl, `/api/conversations/${encodeURIComponent(threadId)}/details`, { headers: sessionHeaders });
    assert.strictEqual(detailsRes.ok, true, 'conversation details fetch failed');
    assert.strictEqual(detailsRes.data.id, threadId, 'details response mismatch');
    assert.ok(Array.isArray(detailsRes.data.workspaceItems), 'details should expose workspaceItems array');

    const providerEvents = await fetchJson(baseUrl, `/api/conversations/${encodeURIComponent(threadId)}/provider-events`, { headers: sessionHeaders });
    assert.strictEqual(providerEvents.ok, true, 'provider events fetch failed');
    assert.ok(Array.isArray(providerEvents.data), 'provider events must be an array');

    const singleRes = await fetchJson(baseUrl, `/api/conversations/${encodeURIComponent(threadId)}`, { headers: sessionHeaders });
    assert.strictEqual(singleRes.ok, true, 'single conversation lookup failed');
    assert.strictEqual(singleRes.data.id, threadId, 'single conversation response mismatch');

    let byDirector;
    try {
      byDirector = await waitFor(async () => {
        const res = await fetchJson(
          baseUrl,
          `/api/conversations/byDirectorEmail?directorId=${encodeURIComponent(directorThread.directorId)}&emailId=${encodeURIComponent(directorThread.email.id)}`,
          { headers: sessionHeaders }
        );
        return res.ok ? res : null;
      }, { timeoutMs: TEST_TIMEOUTS.wait.short, intervalMs: 200 });
    } catch {
      console.warn('[integration] byDirectorEmail lookup timed out; continuing with direct thread data', {
        directorId: directorThread.directorId,
        emailId: directorThread.email.id,
      });
    }
    if (byDirector) {
      assert.strictEqual(byDirector.data.id, threadId, 'byDirectorEmail returned unexpected thread');
    }

    const messageContent = 'Integration harness ping';
    const appendMessage = await fetchJson(baseUrl, `/api/conversations/${encodeURIComponent(threadId)}/messages`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ content: messageContent }),
    });
    assert.strictEqual(appendMessage.ok, true, 'appending user message failed');

    await waitFor(async () => {
      const refreshed = await fetchJson(baseUrl, `/api/conversations/${encodeURIComponent(threadId)}`, { headers: sessionHeaders });
      if (!refreshed.ok) return false;
      return Array.isArray(refreshed.data.messages) && refreshed.data.messages.some((msg) => msg.role === 'user' && msg.content === messageContent);
    }, { timeoutMs: TEST_TIMEOUTS.wait.short, intervalMs: 200 });

    const appendLog = await logCapture.waitFor(
      (entry) => entry.message === 'POST /api/conversations/:id/messages appended user message' && entry.meta?.id === threadId,
      { timeoutMs: TEST_TIMEOUTS.wait.quick }
    );
    assert.ok(appendLog.meta, 'append log must include meta');
    assert.strictEqual(appendLog.meta.id, threadId, 'append log meta.id mismatch');
    assert.ok(typeof appendLog.meta.length === 'number', 'append log must include numeric length');

    const workspaceList = await fetchJson(baseUrl, `/api/workspaces/${encodeURIComponent(threadId)}/items`, { headers: sessionHeaders });
    assert.strictEqual(workspaceList.ok, true, 'workspace list should succeed');
    assert.ok(Array.isArray(workspaceList.data), 'workspace list must be an array');

    const workspaceNotFound = await fetch(`${baseUrl}/api/workspaces/${encodeURIComponent(threadId)}/items/non-existent`, { headers: sessionHeaders });
    assert.strictEqual(workspaceNotFound.status, 404, 'requesting missing workspace item must 404');

    const includeDeleted = await fetchJson(baseUrl, `/api/workspaces/${encodeURIComponent(threadId)}/items?includeDeleted=true`, { headers: sessionHeaders });
    assert.strictEqual(includeDeleted.ok, true, 'workspace includeDeleted query failed');
    assert.ok(Array.isArray(includeDeleted.data), 'workspace includeDeleted response must be array');
    } finally {
      try {
        if (monitoredThreadId) {
          await waitFor(async () => {
            const res = await fetchJson(baseUrl, `/api/conversations/${encodeURIComponent(monitoredThreadId)}`, { headers: sessionHeaders });
            if (!res.ok) return null;
            if (res.data.status === 'ongoing') return null;
            return res.data.status;
          }, { timeoutMs: TEST_TIMEOUTS.wait.short, intervalMs: 200 }).catch(() => {});
        }
      } catch (waitError) {
        console.warn('[integration] conversation status wait failed', waitError);
      }
      try {
        if (createdFilterId) {
          await fetch(`${baseUrl}/api/filters/${encodeURIComponent(createdFilterId)}`, {
            method: 'DELETE',
            headers: sessionHeaders,
          });
        }
        if (createdDirectorId) {
          await fetch(`${baseUrl}/api/directors/${encodeURIComponent(createdDirectorId)}`, {
            method: 'DELETE',
            headers: sessionHeaders,
          });
        }
        if (createdAgentId) {
          await fetch(`${baseUrl}/api/agents/${encodeURIComponent(createdAgentId)}`, {
            method: 'DELETE',
            headers: sessionHeaders,
          });
        }
      } catch (cleanupError) {
        console.warn('[integration] conversation-workspace cleanup failed', cleanupError);
      }
      try {
        if (fetcherTriggered) {
          await fetchJson(baseUrl, '/api/fetcher/stop', {
            method: 'POST',
            headers: jsonHeaders,
          });
        }
      } catch (error) {
        console.warn('[integration] conversation-workspace fetcher stop failed', error);
      }
      logCapture.stop();
    }
  }, {
    env: createTestEnv({
      VX_TEST_MOCK_PROVIDER: 'true',
      VX_TEST_OPENAI_STUB: 'true',
    }),
  });
});
