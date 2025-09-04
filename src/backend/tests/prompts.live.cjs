const { test } = require('node:test');
const assert = require('node:assert');
const { createAuthHeaders, fetchJson } = require('./lib/harness.cjs');

const BASE = process.env.BACKEND_URL || 'http://localhost:3001';
const TEST_UID = process.env.VX_TEST_USER_ID || 'test-user';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-jwt';
const headers = { ...createAuthHeaders({ uid: TEST_UID, jwtSecret: JWT_SECRET }), 'Content-Type': 'application/json' };

async function ensureDelete(path, id) {
  const list = await fetchJson(`${BASE}${path}`, { headers });
  if (!list.ok) return;
  const item = (list.data || []).find(x => x.id === id);
  if (item) await fetchJson(`${BASE}${path}/${encodeURIComponent(id)}`, { method: 'DELETE', headers });
}

test('Live CRUD: prompts', async () => {
  const id = `pr_${Date.now()}`;
  await ensureDelete('/api/prompts', id);

  const create = await fetchJson(`${BASE}/api/prompts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id, name: 'Test Prompt', messages: [{ role: 'system', content: 'You are helpful.' }] })
  });
  assert.strictEqual(create.ok, true);

  const list = await fetchJson(`${BASE}/api/prompts`, { headers });
  assert.strictEqual(list.ok, true);
  assert.ok((list.data || []).some(p => p.id === id));

  const update = await fetchJson(`${BASE}/api/prompts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ id, name: 'Test Prompt v2', messages: [{ role: 'system', content: 'Be concise.' }] })
  });
  assert.strictEqual(update.ok, true);

  const del = await fetchJson(`${BASE}/api/prompts/${encodeURIComponent(id)}`, { method: 'DELETE', headers });
  assert.strictEqual(del.ok, true);
});

test('Live CRUD: prompt-templates and imprints', async () => {
  const tid = `pt_${Date.now()}`;
  const iid = `im_${Date.now()+1}`;
  await ensureDelete('/api/prompt-templates', tid);
  await ensureDelete('/api/imprints', iid);

  const ct = await fetchJson(`${BASE}/api/prompt-templates`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: tid, name: 'Template', messages: [{ role: 'system', content: 'Template system.' }] })
  });
  assert.strictEqual(ct.ok, true);

  const ut = await fetchJson(`${BASE}/api/prompt-templates/${encodeURIComponent(tid)}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ id: tid, name: 'Template v2', messages: [{ role: 'system', content: 'Template v2.' }] })
  });
  assert.strictEqual(ut.ok, true);

  const ci = await fetchJson(`${BASE}/api/imprints`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: iid, name: 'Imprint', content: 'Memo' })
  });
  assert.strictEqual(ci.ok, true);

  const di = await fetchJson(`${BASE}/api/imprints/${encodeURIComponent(iid)}`, { method: 'DELETE', headers });
  assert.strictEqual(di.ok, true);

  const dt = await fetchJson(`${BASE}/api/prompt-templates/${encodeURIComponent(tid)}`, { method: 'DELETE', headers });
  assert.strictEqual(dt.ok, true);
});

