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

test('conversation API preserves tool call and tool result messages', { concurrency: false, timeout: TEST_TIMEOUTS.node.standard }, async () => {
  await withServer(async ({ baseUrl }) => {
    const { headers: sessionHeaders } = await createSession(baseUrl, uid);
    const jsonHeaders = authHeaders(sessionHeaders, { 'Content-Type': 'application/json' });

    const beforeRes = await fetchJson(baseUrl, '/api/conversations?limit=200&offset=0', { headers: sessionHeaders });
    assert.strictEqual(beforeRes.ok, true, '/api/conversations pre-run failed');
    const beforeIds = new Set((beforeRes.data?.items || []).map((thread) => thread.id));

    const runRes = await fetchJson(baseUrl, '/api/fetcher/run', { method: 'POST', headers: jsonHeaders }, { timeoutMs: TEST_TIMEOUTS.http.fetcher });
    assert.strictEqual(runRes.ok, true, `/api/fetcher/run failed: ${JSON.stringify(runRes.data)}`);

    const { directorThread } = await waitFor(async () => {
      const listRes = await fetchJson(baseUrl, '/api/conversations?limit=200&offset=0', { headers: sessionHeaders });
      if (!listRes.ok) return null;
      const items = listRes.data?.items || [];
      const newThreads = items.filter((thread) => !beforeIds.has(thread.id));
      const director = newThreads.find((thread) => thread.kind === 'director');
      if (!director) return null;
      return { directorThread: director };
    }, { timeoutMs: TEST_TIMEOUTS.wait.medium, intervalMs: 200 });

    assert.ok(directorThread, 'Expected a completed director thread');

    const threadRes = await fetchJson(baseUrl, `/api/conversations/${directorThread.id}`, { headers: sessionHeaders });
    assert.strictEqual(threadRes.ok, true, `/api/conversations/${directorThread.id} failed`);
    const messages = Array.isArray(threadRes.data?.messages) ? threadRes.data.messages : [];
    assert.ok(messages.length > 0, 'Director thread should have messages');

    const assistantToolCall = messages.find((msg) => Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0);
    assert.ok(assistantToolCall, 'Expected assistant message containing tool_calls');
    const toolCall = assistantToolCall.tool_calls[0];
    assert.ok(toolCall?.function?.name, 'tool call should include function name');
    assert.ok(typeof toolCall.function.arguments === 'string' && toolCall.function.arguments.includes('{'), 'tool call arguments should be serialized JSON');

    const toolResponse = messages.find((msg) => msg?.role === 'tool' && msg?.tool_call_id === toolCall.id);
    assert.ok(toolResponse, 'Expected matching tool response message');
    assert.ok(typeof toolResponse.content === 'string' && toolResponse.content.length > 0, 'Tool response should include payload content');
  }, {
    env: createTestEnv({
      VX_TEST_MOCK_PROVIDER: 'true',
      VX_TEST_OPENAI_STUB: 'true',
    }),
  });
});
