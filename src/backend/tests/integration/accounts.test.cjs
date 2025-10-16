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

test('integration: account lifecycle enforces invariants', { concurrency: false, timeout: 20000 }, async () => {
  await runSerial(async () => {
    const { baseUrl, stop } = await startBackend();
    const { headers: sessionHeaders } = await createSession(baseUrl, uid);
    const jsonHeaders = authHeaders(sessionHeaders, { 'Content-Type': 'application/json' });

    const accountId = `int-account-${Date.now()}`;

    try {
      const invalidBody = await fetch(`${baseUrl}/api/accounts`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ id: 'bad-account', provider: 'test', email: 'bad@example.com' }),
    });
    assert.strictEqual(invalidBody.status, 400, 'missing tokens should trigger validation error');

    const createAccountRes = await fetchJson(baseUrl, '/api/accounts', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        id: accountId,
        provider: 'gmail',
        email: 'integration@example.com',
        signature: 'Original Signature',
        tokens: {
          accessToken: 'token-access',
          refreshToken: 'token-refresh',
          expiry: new Date(Date.now() + 3600_000).toISOString(),
        },
      }),
    });
    assert.strictEqual(createAccountRes.ok, true, 'account creation failed');

    const listRes = await fetchJson(baseUrl, '/api/accounts', { headers: sessionHeaders });
    assert.strictEqual(listRes.ok, true, '/api/accounts list failed');
    const account = Array.isArray(listRes.data) && listRes.data.find((a) => a.id === accountId);
    assert.ok(account, 'created account not returned by list');
    assert.strictEqual(account.tokens.accessToken, 'REDACTED', 'access token must be redacted');

    const blankSignature = await fetch(`${baseUrl}/api/accounts/${encodeURIComponent(accountId)}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ signature: '' }),
    });
    assert.strictEqual(blankSignature.status, 400, 'blank signature should be rejected');

    const updateSignature = await fetchJson(baseUrl, `/api/accounts/${encodeURIComponent(accountId)}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ signature: 'Updated Signature' }),
    });
    assert.strictEqual(updateSignature.ok, true, 'account signature update failed');

    const unauthorizedList = await fetch(`${baseUrl}/api/accounts`, { method: 'GET' });
    assert.strictEqual(unauthorizedList.status, 401, 'unauthenticated account request must fail');

    const refreshRes = await fetchJson(baseUrl, `/api/accounts/${encodeURIComponent(accountId)}/refresh`, {
      method: 'POST',
      headers: jsonHeaders,
    });
    assert.strictEqual(refreshRes.ok, true, 'refresh request should complete');
    assert.strictEqual(refreshRes.status, 200, 'refresh responds with 200 even on failure');
    assert.ok(typeof refreshRes.data === 'object' && refreshRes.data !== null, 'refresh should respond with payload');
    } finally {
      await fetch(`${baseUrl}/api/accounts/${encodeURIComponent(accountId)}`, {
        method: 'DELETE',
        headers: sessionHeaders,
      }).catch((error) => console.warn('[integration] account cleanup failed', error));
      await stop();
    }
  });
});
