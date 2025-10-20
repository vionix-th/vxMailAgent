const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  discoverTestUser,
  withServer,
  createSession,
  fetchJson,
} = require('../lib/harness');
const { createTestEnv, TEST_TIMEOUTS } = require('../lib/testEnv');

const { uid } = discoverTestUser();

function authHeaders(sessionHeaders, extra = {}) {
  return { ...sessionHeaders, ...extra };
}

test('integration: prompt-assist endpoints with OpenAI stub', { concurrency: false, timeout: TEST_TIMEOUTS.node.short }, async () => {
  await withServer(async ({ baseUrl }) => {
    const { headers: sessionHeaders } = await createSession(baseUrl, uid);
    const jsonHeaders = authHeaders(sessionHeaders, { 'Content-Type': 'application/json' });

    const created = { apiConfigId: undefined, directorId: undefined };

    try {
      // Create a temporary API config using the stubbed provider path
      const apiId = `int-openai-stub-${Date.now()}`;
      const createCfg = await fetchJson(baseUrl, '/api/settings/api-configs', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ id: apiId, name: 'OpenAI Stub', model: 'gpt-4o-mini', apiKey: 'sk-stub', provider: 'openai' }),
      });
      assert.strictEqual(createCfg.status, 201, 'failed to create stub api config');
      created.apiConfigId = apiId;

    // Pick an existing prompt to use
    const promptsRes = await fetchJson(baseUrl, '/api/prompts', { headers: sessionHeaders });
    assert.strictEqual(promptsRes.ok, true, '/api/prompts failed');
    const prompt = (Array.isArray(promptsRes.data) && promptsRes.data[0]) || null;
    assert.ok(prompt, 'no prompt available for test user');

    // /api/test/chat — send a minimal message and expect stubbed success
    const chatRes = await fetchJson(baseUrl, '/api/test/chat', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ apiConfigId: apiId, messages: [{ role: 'user', content: 'hello' }] }),
    }, { timeoutMs: TEST_TIMEOUTS.http.medium });
    assert.strictEqual(chatRes.ok, true, '/api/test/chat failed');
    assert.strictEqual(chatRes.data.success, true, 'chat result not marked success');
    assert.strictEqual(chatRes.data.assistantMessage?.content, 'stubbed-response', 'expected stubbed assistant response');

    // Create a director bound to the stubbed config for /api/test/director/:id
    const directorId = `int-director-stub-${Date.now()}`;
    const makeDirector = await fetchJson(baseUrl, '/api/directors', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ id: directorId, name: 'Stub Director', agentIds: [], promptId: prompt.id, apiConfigId: apiId, enabledOptionalTools: [] }),
    });
    assert.strictEqual(makeDirector.status, 201, 'director create failed');
    created.directorId = directorId;

    const dirTest = await fetchJson(baseUrl, `/api/test/director/${encodeURIComponent(directorId)}`, { headers: sessionHeaders }, { timeoutMs: TEST_TIMEOUTS.http.medium });
    assert.strictEqual(dirTest.ok, true, '/api/test/director/:id failed');
    assert.strictEqual(dirTest.data.success, true, 'director test did not succeed');
    assert.strictEqual(dirTest.data.assistantMessage?.content, 'stubbed-response', 'expected stubbed assistant response for director');

    // Failure path: invalid payload to /api/test/chat (missing messages)
    const badChat = await fetch(`${baseUrl}/api/test/chat`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ apiConfigId: apiId }) });
    assert.strictEqual(badChat.status, 400, 'invalid /api/test/chat payload must 400');
    } finally {
      // Cleanup
      if (created.directorId) {
        await fetch(`${baseUrl}/api/directors/${encodeURIComponent(created.directorId)}`, { method: 'DELETE', headers: sessionHeaders }).catch(() => {});
      }
      if (created.apiConfigId) {
        await fetch(`${baseUrl}/api/settings/api-configs/${encodeURIComponent(created.apiConfigId)}`, { method: 'DELETE', headers: sessionHeaders }).catch(() => {});
      }
    }
  }, {
    env: createTestEnv({ VX_TEST_OPENAI_STUB: 'true' }),
  });
});
