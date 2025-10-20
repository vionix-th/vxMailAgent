const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  discoverTestUser,
  withServer,
  createSession,
  fetchJson,
  waitFor,
  createLogCapture,
  assertMetaFields,
} = require('../lib/harness');
const { createTestEnv, TEST_TIMEOUTS } = require('../lib/testEnv');

const { uid } = discoverTestUser();

function authHeaders(sessionHeaders, extra = {}) {
  return { ...sessionHeaders, ...extra };
}

test('integration: orchestrator emits structured failure when apiConfig missing', { concurrency: false, timeout: TEST_TIMEOUTS.node.standard }, async () => {
  await withServer(async ({ baseUrl }) => {
    const logCapture = createLogCapture();
    const { headers: sessionHeaders } = await createSession(baseUrl, uid);
    const jsonHeaders = authHeaders(sessionHeaders, { 'Content-Type': 'application/json' });

  const ids = {
    director: `int-orch-missingcfg-${Date.now()}`,
    filter: `int-orch-missingcfg-filter-${Date.now()}`,
    apiConfig: `int-orch-stubcfg-${Date.now()}`,
  };
  let fetcherTriggered = false;
  let threadId;

  try {
    // Acquire a valid prompt for the director; use first available.
    const promptsRes = await fetchJson(baseUrl, '/api/prompts', { headers: sessionHeaders });
    assert.strictEqual(promptsRes.ok, true, '/api/prompts failed');
    const prompt = Array.isArray(promptsRes.data) && promptsRes.data[0];
    assert.ok(prompt && prompt.id, 'expected at least one prompt for the test user');

    // Create a temporary valid API config (stubbed provider)
    const createCfg = await fetchJson(baseUrl, '/api/settings/api-configs', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ id: ids.apiConfig, name: 'Orch Stub', model: 'gpt-4o-mini', apiKey: 'sk-stub', provider: 'openai' }),
    });
    assert.strictEqual(createCfg.status, 201, 'failed to create temporary api config');

    // Create a director that references the valid apiConfig so the thread can be created
    const createDirector = await fetchJson(baseUrl, '/api/directors', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        id: ids.director,
        name: 'Orch Missing Config Director',
        agentIds: [],
        promptId: prompt.id,
        apiConfigId: ids.apiConfig,
        enabledOptionalTools: [],
      }),
    });
    assert.strictEqual(createDirector.status, 201, 'director creation should return 201');

    // Create a filter that will match the mock provider subject and trigger the director
    const createFilter = await fetchJson(baseUrl, '/api/filters', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        id: ids.filter,
        field: 'subject',
        regex: 'E2E TEST: mock provider subject',
        directorId: ids.director,
        duplicateAllowed: false,
      }),
    });
    assert.strictEqual(createFilter.status, 201, 'filter creation failed');

    // Trigger the fetcher to create a director conversation thread
    const runRes = await fetchJson(baseUrl, '/api/fetcher/run', { method: 'POST', headers: jsonHeaders }, { timeoutMs: TEST_TIMEOUTS.http.fetcher });
    assert.strictEqual(runRes.ok, true, '/api/fetcher/run failed');
    fetcherTriggered = true;

    const convo = await waitFor(async () => {
      const list = await fetchJson(baseUrl, '/api/conversations?limit=200&offset=0', { headers: sessionHeaders });
      if (!list.ok) return null;
      const items = Array.isArray(list.data?.items) ? list.data.items : [];
      const directorThread = items.find((t) => t.kind === 'director' && t.directorId === ids.director);
      return directorThread || null;
    }, { timeoutMs: TEST_TIMEOUTS.wait.standard, intervalMs: 250 });

    assert.ok(convo && convo.id, 'expected a director conversation thread');
    threadId = convo.id;

    // Remove the API config to induce orchestrator failure
    await fetchJson(baseUrl, `/api/settings/api-configs/${encodeURIComponent(ids.apiConfig)}`, { method: 'DELETE', headers: sessionHeaders });

    // Invoke assistant on the now-misconfigured director thread; expect failure
    const traceId = `it-trace-${Date.now()}`;
    const assistant = await fetch(`${baseUrl}/api/conversations/${encodeURIComponent(threadId)}/assistant`, {
      method: 'POST',
      headers: { ...jsonHeaders, 'X-Trace-Id': traceId },
    });
    assert.ok(assistant.status >= 400, 'assistant call should fail for missing apiConfig');

    // Assert that a structured failure log entry was emitted with required metadata
    const failureLog = await logCapture.waitFor((entry) => (
      entry.level === 'error' &&
      entry.message === 'Conversation step failed' &&
      entry.meta && entry.meta.conversationId === threadId && entry.meta.directorId === ids.director
    ), { timeoutMs: TEST_TIMEOUTS.wait.short, intervalMs: 100 });

    assertMetaFields(failureLog, ['runId', 'directorId', 'conversationId', 'stepType', 'traceId']);
    assert.strictEqual(failureLog.meta.stepType, 'director_llm', 'unexpected stepType');
    assert.ok(typeof failureLog.meta.error === 'string' && /config not found/i.test(failureLog.meta.error), 'failure error message not informative');
    } finally {
      try {
        if (ids.filter) {
          await fetch(`${baseUrl}/api/filters/${encodeURIComponent(ids.filter)}`, { method: 'DELETE', headers: sessionHeaders });
        }
        if (ids.director) {
          await fetch(`${baseUrl}/api/directors/${encodeURIComponent(ids.director)}`, { method: 'DELETE', headers: sessionHeaders });
        }
        // Best-effort cleanup: in case the config still exists
        await fetch(`${baseUrl}/api/settings/api-configs/${encodeURIComponent(ids.apiConfig)}`, { method: 'DELETE', headers: sessionHeaders }).catch(() => {});
        if (fetcherTriggered) {
          await fetchJson(baseUrl, '/api/fetcher/stop', { method: 'POST', headers: jsonHeaders }).catch(() => {});
        }
      } catch {
        // ignore cleanup errors
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
