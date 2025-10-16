const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  discoverTestUser,
  startBackend,
  createSession,
  fetchJson,
} = require('../lib/harness');
const { runSerial } = require('./lib/serial');

const { uid, fsPath } = discoverTestUser();

function authHeaders(sessionHeaders, extra = {}) {
  return { ...sessionHeaders, ...extra };
}

test('integration: settings and api-config management', { concurrency: false, timeout: 20000 }, async () => {
  await runSerial(async () => {
    const { baseUrl, stop } = await startBackend();
    const { headers: sessionHeaders } = await createSession(baseUrl, uid);
    const jsonHeaders = authHeaders(sessionHeaders, { 'Content-Type': 'application/json' });

    const createdConfigIds = [];
    let originalSettings;

    try {
      const settingsRes = await fetchJson(baseUrl, '/api/settings', { headers: sessionHeaders });
      assert.strictEqual(settingsRes.ok, true, `/api/settings failed: ${JSON.stringify(settingsRes.data)}`);
      originalSettings = settingsRes.data;
      assert.ok(Array.isArray(settingsRes.data.apiConfigs), 'settings must expose apiConfigs array');
      const firstConfig = settingsRes.data.apiConfigs[0];
      if (firstConfig) {
        assert.ok(!Object.prototype.hasOwnProperty.call(firstConfig, 'apiKey'), 'settings response leaks apiKey');
      }

      const nextTimeout = (settingsRes.data.sessionTimeoutMinutes ?? 0) + 5;
      const updateRes = await fetchJson(baseUrl, '/api/settings', {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ sessionTimeoutMinutes: nextTimeout }),
      });
      assert.strictEqual(updateRes.ok, true, `/api/settings PUT failed: ${JSON.stringify(updateRes.data)}`);
      assert.strictEqual(updateRes.data.settings.sessionTimeoutMinutes, nextTimeout, 'PUT /api/settings did not persist timeout');

      const configId = `int-config-${Date.now()}`;
      const createConfig = await fetchJson(baseUrl, '/api/settings/api-configs', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          id: configId,
          name: 'Integration Config',
          model: 'gpt-4o-mini',
          apiKey: 'sk-integration-test-key',
          provider: 'openai',
        }),
      });
      assert.strictEqual(createConfig.status, 201, `API config creation failed: ${JSON.stringify(createConfig.data)}`);
      createdConfigIds.push(configId);
      assert.ok(!Object.prototype.hasOwnProperty.call(createConfig.data.apiConfig, 'apiKey'), 'create response leaks apiKey');

      const afterCreate = await fetchJson(baseUrl, '/api/settings', { headers: sessionHeaders });
      const found = Array.isArray(afterCreate.data.apiConfigs)
        && afterCreate.data.apiConfigs.find((cfg) => cfg.id === configId);
      assert.ok(found, 'created apiConfig missing from settings');

      const missingKeyRes = await fetchJson(baseUrl, '/api/settings/api-configs', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ name: 'Invalid Config', model: 'gpt-4', apiKey: '' }),
      });
      assert.ok(missingKeyRes.status >= 400, 'missing apiKey must fail with client error');

      const unauthorizedRes = await fetch(`${baseUrl}/api/settings/api-configs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Unauthorized', model: 'gpt-4o', apiKey: 'sk-unauth' }),
      });
      assert.strictEqual(unauthorizedRes.status, 401, 'unauthenticated request must be rejected');
    } finally {
      for (const id of createdConfigIds) {
        await fetch(`${baseUrl}/api/settings/api-configs/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: sessionHeaders,
        }).catch((error) => console.warn('[integration] cleanup delete api-config failed', id, error));
      }
      if (originalSettings) {
        try {
          await fetchJson(baseUrl, '/api/settings', {
            method: 'PUT',
            headers: jsonHeaders,
            body: JSON.stringify({ sessionTimeoutMinutes: originalSettings.sessionTimeoutMinutes }),
          });
        } catch (error) {
          console.warn('[integration] failed to restore sessionTimeoutMinutes', error);
        }
      }
      await stop();
    }
  });
});
