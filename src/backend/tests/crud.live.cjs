const { test } = require('node:test');
const assert = require('node:assert');
const { createAuthHeaders, fetchJson, withHeartbeat, logEvent } = require('./lib/harness.cjs');

const BASE = process.env.BACKEND_URL || 'http://localhost:3001';
const TEST_UID = process.env.VX_TEST_USER_ID || 'test-user';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-jwt';
const headers = createAuthHeaders({ uid: TEST_UID, jwtSecret: JWT_SECRET });
headers['Content-Type'] = 'application/json';

async function ensureDelete(path, id) {
  const list = await fetchJson(`${BASE}${path}`, { headers });
  if (!list.ok) return;
  const item = (list.data || []).find(x => x.id === id);
  if (item) {
    await fetchJson(`${BASE}${path}/${encodeURIComponent(id)}`, { method: 'DELETE', headers });
  }
}

test('Live CRUD: security check (uid param rejected)', async () => {
  const r = await fetchJson(`${BASE}/api/settings?uid=evil`, { headers });
  assert.strictEqual(r.status, 403);
});

test('Live CRUD: settings upsert + readback', async () => {
  const cfgId = `cfg_${Date.now()}`;
  const put = await withHeartbeat(fetchJson(`${BASE}/api/settings`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      virtualRoot: '',
      apiConfigs: [ { id: cfgId, name: 'Test OpenAI', provider: 'openai', apiKey: 'test-key' } ],
      fetcherAutoStart: false,
      sessionTimeoutMinutes: 15
    })
  }), 'settings_put');
  logEvent({ type: 'crud', name: 'settings_put', ok: put.ok, status: put.status });
  assert.strictEqual(put.ok, true);

  const get = await fetchJson(`${BASE}/api/settings`, { headers });
  assert.strictEqual(get.ok, true);
  assert.ok(Array.isArray(get.data.apiConfigs));
  assert.ok(get.data.apiConfigs.some(c => c.id === cfgId));
});

test('Live CRUD: directors/agents create, update, delete', async () => {
  // Read current settings to get an apiConfigId
  const settings = await fetchJson(`${BASE}/api/settings`, { headers });
  assert.strictEqual(settings.ok, true);
  const apiConfigId = settings.data.apiConfigs[0]?.id;
  assert.ok(apiConfigId, 'No apiConfigId available; ensure settings test ran first');

  const dirId = `dir_${Date.now()}`;
  const agId = `agt_${Date.now()}`;
  await ensureDelete('/api/directors', dirId);
  await ensureDelete('/api/agents', agId);

  // Validation error (missing apiConfigId)
  const bad = await fetchJson(`${BASE}/api/directors`, { method: 'POST', headers, body: JSON.stringify({ id: 'bad1', name: 'Bad' }) });
  assert.strictEqual(bad.status, 400);

  // Create director
  const createDir = await fetchJson(`${BASE}/api/directors`, { method: 'POST', headers, body: JSON.stringify({ id: dirId, name: 'D1', apiConfigId }) });
  assert.strictEqual(createDir.ok, true);
  // Update director
  const updDir = await fetchJson(`${BASE}/api/directors/${encodeURIComponent(dirId)}`, { method: 'PUT', headers, body: JSON.stringify({ id: dirId, name: 'D1-renamed', apiConfigId }) });
  assert.strictEqual(updDir.ok, true);

  // Create agent
  const createAg = await fetchJson(`${BASE}/api/agents`, { method: 'POST', headers, body: JSON.stringify({ id: agId, name: 'A1', apiConfigId }) });
  assert.strictEqual(createAg.ok, true);
  // Update agent
  const updAg = await fetchJson(`${BASE}/api/agents/${encodeURIComponent(agId)}`, { method: 'PUT', headers, body: JSON.stringify({ id: agId, name: 'A1-renamed', apiConfigId }) });
  assert.strictEqual(updAg.ok, true);

  // Cleanup
  const delAg = await fetchJson(`${BASE}/api/agents/${encodeURIComponent(agId)}`, { method: 'DELETE', headers });
  assert.strictEqual(delAg.ok, true);
  const delDir = await fetchJson(`${BASE}/api/directors/${encodeURIComponent(dirId)}`, { method: 'DELETE', headers });
  assert.strictEqual(delDir.ok, true);
});

test('Live CRUD: filters create + reorder', async () => {
  const f1 = `flt_${Date.now()}`;
  const f2 = `flt_${Date.now() + 1}`;
  await ensureDelete('/api/filters', f1);
  await ensureDelete('/api/filters', f2);

  // Invalid regex
  const bad = await fetchJson(`${BASE}/api/filters`, { method: 'POST', headers, body: JSON.stringify({ id: 'badf', field: 'subject', regex: '(' }) });
  assert.strictEqual(bad.status, 400);

  // Create two filters
  const c1 = await fetchJson(`${BASE}/api/filters`, { method: 'POST', headers, body: JSON.stringify({ id: f1, field: 'subject', regex: 'Urgent' }) });
  assert.strictEqual(c1.ok, true);
  const c2 = await fetchJson(`${BASE}/api/filters`, { method: 'POST', headers, body: JSON.stringify({ id: f2, field: 'from', regex: 'boss@' }) });
  assert.strictEqual(c2.ok, true);

  // Reorder
  const ro = await fetchJson(`${BASE}/api/filters/reorder`, { method: 'PUT', headers, body: JSON.stringify({ orderedIds: [f2, f1] }) });
  assert.strictEqual(ro.ok, true);

  const list = await fetchJson(`${BASE}/api/filters`, { headers });
  assert.strictEqual(list.ok, true);
  const ids = (list.data || []).map(x => x.id);
  const i1 = ids.indexOf(f2);
  const i2 = ids.indexOf(f1);
  assert.ok(i1 > -1 && i2 > -1 && i1 < i2, 'Reorder did not place f2 before f1');

  // Cleanup
  await fetchJson(`${BASE}/api/filters/${encodeURIComponent(f1)}`, { method: 'DELETE', headers });
  await fetchJson(`${BASE}/api/filters/${encodeURIComponent(f2)}`, { method: 'DELETE', headers });
});

test('Live: diagnostics + conversations list', async () => {
  const diag = await fetchJson(`${BASE}/api/diagnostics/runtime`, { headers });
  assert.strictEqual(diag.ok, true);
  assert.ok(typeof diag.data.orchestrationLogCount === 'number');

  const conv = await fetchJson(`${BASE}/api/conversations?limit=5&offset=0`, { headers });
  assert.strictEqual(conv.ok, true);
  assert.ok(typeof conv.data.total === 'number');
});

