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

async function seedPrompt() {
  const pid = `p_${Date.now()}`;
  const cp = await fetchJson(`${BASE}/api/prompts`, { method: 'POST', headers, body: JSON.stringify({ id: pid, name: 'Dir Prompt', messages: [{ role: 'system', content: 'You are a director.' }] }) });
  assert.strictEqual(cp.ok, true);
  return pid;
}

async function createDirector(apiConfigId, promptId, suffix) {
  const did = `d_${suffix}_${Date.now()}`;
  const cd = await fetchJson(`${BASE}/api/directors`, { method: 'POST', headers, body: JSON.stringify({ id: did, name: `Dir ${suffix}`, apiConfigId, promptId }) });
  assert.strictEqual(cd.ok, true);
  return did;
}

async function createFilter(field, regex, directorId) {
  const fid = `f_${field}_${Date.now()}`;
  const cf = await fetchJson(`${BASE}/api/filters`, { method: 'POST', headers, body: JSON.stringify({ id: fid, field, regex, directorId }) });
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

test('Live: recipient field filters (to/cc) trigger directors', async () => {
  const before = await listConversations();
  const cfgId = await seedSettingsWithApiConfig();
  const pid = await seedPrompt();
  const dirSubject = await createDirector(cfgId, pid, 'subject');
  const dirTo = await createDirector(cfgId, pid, 'to');
  const dirCc = await createDirector(cfgId, pid, 'cc');

  await createFilter('subject', 'E2E TEST', dirSubject);
  await createFilter('to', 'recipient@example.com', dirTo);
  await createFilter('cc', 'manager@example.com', dirCc);

  await seedAccountGmail();

  await withHeartbeat(fetchJson(`${BASE}/api/fetcher/run`, { method: 'POST', headers }), 'fetcher_run_recipient_filters');

  // Poll for new conversations
  let attempts = 0;
  let after;
  while (attempts++ < 30) {
    await new Promise(r => setTimeout(r, 250));
    after = await listConversations();
    const created = after.filter(c => !before.find(b => b.id === c.id));
    if (created.length >= 3) break;
  }

  const created = after.filter(c => !before.find(b => b.id === c.id));
  assert.ok(created.length >= 3, `Expected >=3 new conversations, got ${created.length}`);
  const byDir = new Map();
  created.forEach(c => byDir.set(c.directorId, (byDir.get(c.directorId) || 0) + 1));
  assert.ok(byDir.has(dirSubject), 'subject filter did not trigger');
  assert.ok(byDir.has(dirTo), 'to filter did not trigger');
  assert.ok(byDir.has(dirCc), 'cc filter did not trigger');
});
