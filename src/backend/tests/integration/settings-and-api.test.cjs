const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  discoverTestUser,
  startBackend,
  createSession,
  fetchJson,
} = require('../lib/harness');
const { TEST_TIMEOUTS } = require('../lib/testEnv');
const { uid } = discoverTestUser();

function userDbPath(uidValue) {
  const dataDir = process.env.VX_MAILAGENT_DATA_DIR;
  assert.ok(typeof dataDir === 'string' && dataDir, 'VX_MAILAGENT_DATA_DIR must be set during integration tests');
  const safeUid = uidValue.replace(/:/g, '_');
  return path.join(dataDir, 'users', safeUid, 'user.sqlite3');
}

function restoreSettings(dbFile, snapshot) {
  const db = new Database(dbFile);
  try {
    db.prepare(
      'REPLACE INTO settings (id, virtual_root, api_configs_json, signatures_json, fetcher_auto_start, session_timeout_minutes) VALUES (@id, @virtual_root, @api_configs_json, @signatures_json, @fetcher_auto_start, @session_timeout_minutes)'
    ).run({
      id: 1,
      virtual_root: snapshot.virtual_root,
      api_configs_json: snapshot.api_configs_json,
      signatures_json: snapshot.signatures_json,
      fetcher_auto_start: snapshot.fetcher_auto_start,
      session_timeout_minutes: snapshot.session_timeout_minutes,
    });
  } finally {
    db.close();
  }
}

test('integration: settings require explicit provisioning', { concurrency: false, timeout: TEST_TIMEOUTS.node.standard }, async () => {
  const { baseUrl, stop } = await startBackend();
  try {
    const dbFile = userDbPath(uid);
    const db = new Database(dbFile);
    let snapshot;
    try {
      snapshot = db.prepare('SELECT * FROM settings WHERE id = 1').get();
      assert.ok(snapshot, 'expected seeded settings row to exist');
      db.prepare('DELETE FROM settings WHERE id = 1').run();
      const remaining = db.prepare('SELECT COUNT(1) AS count FROM settings').get();
      assert.strictEqual(remaining.count, 0, 'settings row should be removed for provisioning test');
    } finally {
      db.close();
    }

    const { headers: sessionHeaders } = await createSession(baseUrl, uid);

    const missingRes = await fetchJson(baseUrl, '/api/settings', { headers: sessionHeaders });
    assert.strictEqual(missingRes.ok, false, 'GET /api/settings must fail when settings are absent');
    assert.strictEqual(missingRes.status, 412, 'missing settings should return HTTP 412');
    assert.strictEqual(missingRes.data?.code, 'SETTINGS_NOT_INITIALIZED', 'error code must communicate missing settings');
    assert.match(String(missingRes.data?.message ?? ''), /not initialized/i, 'error message should mention initialization');

    restoreSettings(dbFile, snapshot);

    const restored = await fetchJson(baseUrl, '/api/settings', { headers: sessionHeaders });
    assert.strictEqual(restored.ok, true, 'GET /api/settings should succeed once settings restored');
    assert.strictEqual(restored.data?.sessionTimeoutMinutes, snapshot.session_timeout_minutes, 'restored settings must match original timeout');
  } finally {
    await stop();
  }
});

test('integration: api config patch preserves siblings', { concurrency: false, timeout: TEST_TIMEOUTS.node.standard }, async () => {
  const { baseUrl, stop } = await startBackend();
  const { headers: sessionHeaders } = await createSession(baseUrl, uid);
  const jsonHeaders = authHeaders(sessionHeaders, { 'Content-Type': 'application/json' });

  const created = [];
  try {
    const firstId = `int-api-config-a-${Date.now()}`;
    const secondId = `int-api-config-b-${Date.now()}`;

    const createFirst = await fetchJson(baseUrl, '/api/settings/api-configs', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        id: firstId,
        name: 'Integration Config A',
        model: 'gpt-4.1-mini',
        apiKey: 'sk-integration-A',
        provider: 'openai',
      }),
    });
    assert.strictEqual(createFirst.status, 201, `failed to create first api config: ${JSON.stringify(createFirst.data)}`);
    created.push(firstId);

    const createSecond = await fetchJson(baseUrl, '/api/settings/api-configs', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        id: secondId,
        name: 'Integration Config B',
        model: 'gpt-4.1-nano',
        apiKey: 'sk-integration-B',
        provider: 'openai',
      }),
    });
    assert.strictEqual(createSecond.status, 201, `failed to create second api config: ${JSON.stringify(createSecond.data)}`);
    created.push(secondId);

    const patchRes = await fetchJson(baseUrl, '/api/settings', {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({
        apiConfigs: [
          { id: firstId, name: 'Updated Config A', model: 'gpt-4.1', maxCompletionTokens: 3000 },
        ],
      }),
    });
    assert.strictEqual(patchRes.ok, true, `PATCH via PUT /api/settings failed: ${JSON.stringify(patchRes.data)}`);

    const afterPatch = await fetchJson(baseUrl, '/api/settings', { headers: sessionHeaders });
    assert.strictEqual(afterPatch.ok, true, `/api/settings fetch failed: ${JSON.stringify(afterPatch.data)}`);
    const configs = Array.isArray(afterPatch.data.apiConfigs) ? afterPatch.data.apiConfigs : [];
    const updated = configs.find((cfg) => cfg.id === firstId);
    const untouched = configs.find((cfg) => cfg.id === secondId);
    assert.ok(updated, 'updated api config must remain present');
    assert.ok(untouched, 'untouched api config must remain present');
    assert.strictEqual(updated.name, 'Updated Config A', 'updated config should reflect new name');
    assert.strictEqual(updated.model, 'gpt-4.1', 'updated config should reflect new model');
    assert.strictEqual(updated.maxCompletionTokens, 3000, 'updated config should reflect new token limit');
    assert.strictEqual(untouched.name, 'Integration Config B', 'sibling config must retain original name');
    assert.strictEqual(untouched.model, 'gpt-4.1-nano', 'sibling config must retain original model');
  } finally {
    for (const id of created) {
      await fetch(`${baseUrl}/api/settings/api-configs/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: sessionHeaders,
      }).catch((error) => console.warn('[integration] cleanup delete api-config failed', id, error));
    }
    await stop();
  }
});

test('integration: signature patch merges entries', { concurrency: false, timeout: TEST_TIMEOUTS.node.standard }, async () => {
  const { baseUrl, stop } = await startBackend();
  const { headers: sessionHeaders } = await createSession(baseUrl, uid);
  const jsonHeaders = authHeaders(sessionHeaders, { 'Content-Type': 'application/json' });

  const original = await fetchJson(baseUrl, '/api/settings', { headers: sessionHeaders });
  assert.strictEqual(original.ok, true, `failed to load settings for baseline: ${JSON.stringify(original.data)}`);
  const originalSignatures = original.data.signatures && typeof original.data.signatures === 'object'
    ? { ...original.data.signatures }
    : {};

  try {
    const seed = await fetchJson(baseUrl, '/api/settings', {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ signatures: { primary: 'Signature Primary', secondary: 'Signature Secondary' } }),
    });
    assert.strictEqual(seed.ok, true, `failed to seed signatures: ${JSON.stringify(seed.data)}`);

    const merge = await fetchJson(baseUrl, '/api/settings', {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ signatures: { primary: 'Signature Primary Updated' } }),
    });
    assert.strictEqual(merge.ok, true, `failed to merge signatures: ${JSON.stringify(merge.data)}`);

    const after = await fetchJson(baseUrl, '/api/settings', { headers: sessionHeaders });
    assert.strictEqual(after.ok, true, `failed to reload settings: ${JSON.stringify(after.data)}`);
    const signatures = after.data.signatures || {};
    assert.strictEqual(signatures.primary, 'Signature Primary Updated', 'primary signature should reflect update');
    assert.strictEqual(signatures.secondary, 'Signature Secondary', 'secondary signature should remain intact');
  } finally {
    await fetchJson(baseUrl, '/api/settings', {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ signatures: originalSignatures }),
    }).catch((error) => console.warn('[integration] failed to restore signatures', error));
    await stop();
  }
});

function authHeaders(sessionHeaders, extra = {}) {
  return { ...sessionHeaders, ...extra };
}

test('integration: settings and api-config management', { concurrency: false, timeout: TEST_TIMEOUTS.node.standard }, async () => {
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
