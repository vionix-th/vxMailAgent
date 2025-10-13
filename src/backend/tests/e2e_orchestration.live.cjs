const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { createAuthHeaders, fetchJson, withHeartbeat } = require('./lib/harness.cjs');
const { startTestServer } = require('./lib/test-server.cjs');
const { createFixtures } = require('./lib/fixtures.cjs');
const { resolveTestUserId } = require('./lib/env.cjs');

const IN_PROCESS = process.env.VX_TEST_IN_PROCESS_SERVER !== 'false';
const TEST_UID = resolveTestUserId();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-jwt';
let BASE;
let server;
let fixtures;
before(async () => {
  if (IN_PROCESS) {
    server = await startTestServer();
    BASE = server.baseUrl;
    fixtures = createFixtures({ uid: TEST_UID });
  } else {
    BASE = process.env.BACKEND_URL || 'http://localhost:3001';
  }
});

after(async () => {
  if (fixtures) {
    await fixtures.cleanup();
    fixtures = undefined;
  }
  if (server) {
    await server.stop();
    server = undefined;
  }
});
const headers = { ...createAuthHeaders({ uid: TEST_UID, jwtSecret: JWT_SECRET }), 'Content-Type': 'application/json' };

async function seedSettingsWithApiConfigHttp() {
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

async function seedPromptAndDirectorHttp(apiConfigId) {
  const pid = `p_${Date.now()}`;
  const did = `d_${Date.now()}`;
  const cp = await fetchJson(`${BASE}/api/prompts`, { method: 'POST', headers, body: JSON.stringify({ id: pid, name: 'Dir Prompt', messages: [{ role: 'system', content: 'You are a director.' }] }) });
  assert.strictEqual(cp.ok, true);
  const cd = await fetchJson(`${BASE}/api/directors`, { method: 'POST', headers, body: JSON.stringify({ id: did, name: 'Dir', apiConfigId, promptId: pid }) });
  assert.strictEqual(cd.ok, true);
  return { pid, did };
}

async function seedFilterHttp(directorId) {
  const fid = `f_${Date.now()}`;
  const cf = await fetchJson(`${BASE}/api/filters`, { method: 'POST', headers, body: JSON.stringify({ id: fid, field: 'subject', regex: 'E2E TEST', directorId }) });
  assert.strictEqual(cf.ok, true);
  return fid;
}

async function seedAccountGmailHttp() {
  const accId = `acc_${Date.now()}@example.com`;
  const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const body = {
    id: accId,
    provider: 'gmail',
    email: accId,
    signature: '',
    tokens: { accessToken: 'test-access-token', refreshToken: 'test-refresh-token', expiry }
  };
  const ca = await fetchJson(`${BASE}/api/accounts`, { method: 'POST', headers, body: JSON.stringify(body) });
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
  let directorId;
  if (IN_PROCESS) {
    const apiConfig = await fixtures.ensureApiConfig({ model: 'gpt-4o-mini', fetcherAutoStart: false });
    const prompt = await fixtures.ensurePrompt({
      name: 'Dir Prompt',
      messages: [{ role: 'system', content: 'You are a director.' }],
    });
    const director = await fixtures.ensureDirector({ name: 'Dir', apiConfigId: apiConfig.id, promptId: prompt.id });
    await fixtures.ensureFilter({ directorId: director.id, regex: 'E2E TEST' });
    await fixtures.ensureAccount({ provider: 'gmail', signature: '', email: `acc-${Date.now()}@example.com` });
    directorId = director.id;
  } else {
    const cfgId = await seedSettingsWithApiConfigHttp();
    const { did } = await seedPromptAndDirectorHttp(cfgId);
    await seedFilterHttp(did);
    await seedAccountGmailHttp();
    directorId = did;
  }

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
  assert.strictEqual(created.directorId, directorId);
  assert.ok(Array.isArray(created.messages) && created.messages.length >= 2, 'Thread should contain prompt + email context + maybe assistant');

  // If mock openai is on, assistant message should be last
  if (String(process.env.VX_TEST_MOCK_OPENAI || '').toLowerCase() === 'true') {
    const last = created.messages[created.messages.length - 1];
    assert.strictEqual(last.role, 'assistant');
  }
});
