const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  discoverTestUser,
  startBackend,
  createSession,
  fetchJson,
} = require('../lib/harness');

// Acceptance: requires `.testuser` profile with at least one linked account and API config.
const { uid } = discoverTestUser();

function authHeaders(sessionHeaders, extra = {}) {
  return { ...sessionHeaders, ...extra };
}

function ensureNonEmpty(array, label, remediation) {
  if (!Array.isArray(array) || array.length === 0) {
    const hint = remediation ? ` — ${remediation}` : '';
    throw new Error(`[integration] ${label} missing for test user ${uid}${hint}`);
  }
}

test('integration: session bootstrap and account visibility', { concurrency: false, timeout: 15000 }, async () => {
  const { baseUrl, stop } = await startBackend();
  let sessionHeaders;

  try {
    const badRes = await fetch(`${baseUrl}/api/test/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: '' }),
    });
    assert.strictEqual(badRes.status, 400, 'blank uid must be rejected with 400');
    const badPayload = await badRes.json().catch(() => null);
    const errorMessage = typeof badPayload?.error === 'string'
      ? badPayload.error
      : String(badPayload?.message ?? '');
    assert.match(errorMessage, /uid is required/i, 'blank uid error must mention missing uid');

    const session = await createSession(baseUrl, uid);
    assert.ok(typeof session.token === 'string' && session.token.length > 10, 'session must return a non-empty JWT');
    sessionHeaders = session.headers;

    const settingsRes = await fetchJson(baseUrl, '/api/settings', { headers: sessionHeaders });
    assert.strictEqual(settingsRes.ok, true, `/api/settings failed: ${JSON.stringify(settingsRes.data)}`);
    const apiConfigs = Array.isArray(settingsRes.data?.apiConfigs) ? settingsRes.data.apiConfigs : [];
    ensureNonEmpty(apiConfigs, 'API configuration', 'provision an API config for the integration user');

    const accountsRes = await fetchJson(baseUrl, '/api/accounts', { headers: sessionHeaders });
    assert.strictEqual(accountsRes.ok, true, `/api/accounts failed: ${JSON.stringify(accountsRes.data)}`);
    const accounts = Array.isArray(accountsRes.data) ? accountsRes.data : [];
    ensureNonEmpty(accounts, 'Linked mail account', 'connect at least one mailbox for the integration user');
  } finally {
    if (sessionHeaders) {
      try {
        await fetchJson(baseUrl, '/api/fetcher/stop', { method: 'POST', headers: authHeaders(sessionHeaders, { 'Content-Type': 'application/json' }) });
      } catch (error) {
        console.warn('[integration] fetcher stop during harness cleanup failed', error);
      }
    }
    await stop();
  }
});
