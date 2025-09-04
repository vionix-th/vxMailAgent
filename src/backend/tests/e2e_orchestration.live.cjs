const { test } = require('node:test');
const assert = require('node:assert');
const { createAuthHeaders, fetchJson, withHeartbeat } = require('./lib/harness.cjs');

const BASE = process.env.BACKEND_URL || 'http://localhost:3001';
const TEST_UID = process.env.VX_TEST_USER_ID || 'test-user';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-jwt';
const headers = { ...createAuthHeaders({ uid: TEST_UID, jwtSecret: JWT_SECRET }), 'Content-Type': 'application/json' };

async function seedSettingsWithApiConfig() {
  const cfgId = `cfg_${Date.now()}`;
  const put = await fetchJson(`${BASE}/api/settings`, {
    method: 'PUT', headers,
    body: JSON.stringify({
      virtualRoot: '',
      apiConfigs: [{ id: cfgId, name: 'Test OpenAI', provider: 'openai', apiKey: 'mock', model: 'gpt-4o-mini' }],
      fetcherAutoStart: false,
      sessionTimeoutMinutes: 15
    })
  });
  assert.strictEqual(put.ok, true);
  return cfgId;
}

async function seedPromptAndDirector(apiConfigId) {
  const pid = `p_${Date.now()}`;
  const did = `d_${Date.now()}`;
  const cp = await fetchJson(`${BASE}/api/prompts`, { method: 'POST', headers, body: JSON.stringify({ id: pid, name: 'Dir Prompt', messages: [{ role: 'system', content: 'You are a director.' }] }) });
  assert.strictEqual(cp.ok, true);
  const cd = await fetchJson(`${BASE}/api/directors`, { method: 'POST', headers, body: JSON.stringify({ id: did, name: 'Dir', apiConfigId, promptId: pid }) });
  assert.strictEqual(cd.ok, true);
  return { pid, did };
}

async function seedFilter() {
  const fid = `f_${Date.now()}`;
  const cf = await fetchJson(`${BASE}/api/filters`, { method: 'POST', headers, body: JSON.stringify({ id: fid, field: 'subject', regex: 'E2E TEST' }) });
  assert.strictEqual(cf.ok, true);
  return fid;
}

async function seedAccountGmail() {
  const accId = `acc_${Date.now()}@example.com`;
  const ca = await fetchJson(`${BASE}/api/accounts`, { method: 'POST', headers, body: JSON.stringify({ id: accId, provider: 'gmail', email: accId, signature: '', tokens: {} }) });
  assert.strictEqual(ca.ok, true);
  return accId;
}

async function listConversations() {
  const r = await fetchJson(`${BASE}/api/conversations?limit=1000&offset=0`, { headers });
  assert.strictEqual(r.ok, true);
  return r.data.items;
}

test('E2E: Email -> Filter -> Director thread (mock provider, mock openai)', async () => {
  // Precondition: backend started with VX_TEST_MOCK_PROVIDER=true, VX_TEST_MOCK_OPENAI=true
  const before = await listConversations();
  const cfgId = await seedSettingsWithApiConfig();
  const { did } = await seedPromptAndDirector(cfgId);
  await seedFilter();
  await seedAccountGmail();

  await withHeartbeat(fetchJson(`${BASE}/api/fetcher/run`, { method: 'POST', headers }), 'fetcher_run_e2e');

  // Poll for new conversation
  let attempts = 0;
  let after;
  while (attempts++ < 20) {
    await new Promise(r => setTimeout(r, 250));
    after = await listConversations();
    if (after.length > before.length) break;
  }
  assert.ok(after.length > before.length, 'No new conversations created');

  const created = after.find(c => !before.find(b => b.id === c.id));
  assert.ok(created, 'Created thread not found');
  assert.strictEqual(created.kind, 'director');
  assert.strictEqual(created.directorId, did);
  assert.ok(Array.isArray(created.messages) && created.messages.length >= 2, 'Thread should contain prompt + email context + maybe assistant');

  // If mock openai is on, assistant message should be last
  if (String(process.env.VX_TEST_MOCK_OPENAI || '').toLowerCase() === 'true') {
    const last = created.messages[created.messages.length - 1];
    assert.strictEqual(last.role, 'assistant');
  }
});

