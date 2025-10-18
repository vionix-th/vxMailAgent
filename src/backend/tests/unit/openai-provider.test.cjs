const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const provider = require(path.join(__dirname, '..', '..', 'dist/backend/providers/openai.js'));

const reset = (patch = {}) => {
  delete process.env.VX_TEST_FORCE_OPENAI_ERROR;
  delete process.env.VX_TEST_OPENAI_STUB;
  delete process.env.VX_TEST_WORKSPACE_AGENT_ID;
  Object.assign(process.env, patch);
};

test('chatCompletion normalizes aborts into openai_request_timeout_<ms>', async () => {
  reset({ VX_TEST_OPENAI_STUB: 'true', VX_TEST_FORCE_OPENAI_ERROR: 'timeout' });
  let captured;
  await assert.rejects(async () => {
    try {
      await provider.chatCompletion('sk-test', 'test-model', [], {});
    } catch (err) {
      captured = err;
      throw err;
    }
  }, /openai_request_timeout_\d+ms/);
  assert.ok(captured, 'expected timeout error');
  assert.equal(captured.name, 'OpenAIRequestTimeoutError');
  assert.ok(captured.cause, 'normalized timeout should include original error as cause');
});

test('chatCompletion rethrows generic provider errors verbatim', async () => {
  reset({ VX_TEST_OPENAI_STUB: 'true', VX_TEST_FORCE_OPENAI_ERROR: 'error' });
  let captured;
  await assert.rejects(async () => {
    try {
      await provider.chatCompletion('sk-test', 'test-model', [], {});
    } catch (err) {
      captured = err;
      throw err;
    }
  }, /Forced OpenAI error/);
  assert.ok(captured, 'expected forced error');
  assert.equal(captured.message, 'Forced OpenAI error');
});

test('chatCompletion stub yields assistant response when no forced error', async () => {
  reset({ VX_TEST_OPENAI_STUB: 'true' });
  const res = await provider.chatCompletion('sk-test', 'test-model', [], {});
  assert.equal(res.content, 'stubbed-response');
  assert.equal(Array.isArray(res.toolCalls), false);
});

test('reset env cleanup', () => {
  reset();
});
