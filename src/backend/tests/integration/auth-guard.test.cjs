const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startBackend } = require('../lib/harness');
const { TEST_TIMEOUTS } = require('../lib/testEnv');

test('integration: representative endpoints require authentication', { concurrency: false, timeout: TEST_TIMEOUTS.node.short }, async () => {
  const { baseUrl, stop } = await startBackend();
  try {
    const unauthSettings = await fetch(`${baseUrl}/api/settings`);
    assert.strictEqual(unauthSettings.status, 401, 'GET /api/settings without auth should 401');

    const unauthPrompts = await fetch(`${baseUrl}/api/prompts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    assert.strictEqual(unauthPrompts.status, 401, 'POST /api/prompts without auth should 401');

    const unauthFetcherLogs = await fetch(`${baseUrl}/api/fetcher/logs`);
    assert.strictEqual(unauthFetcherLogs.status, 401, 'GET /api/fetcher/logs without auth should 401');
  } finally {
    await stop();
  }
});
