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
const headers = { ...createAuthHeaders({ uid: TEST_UID, jwtSecret: JWT_SECRET }), 'Content-Type': 'application/json' };

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

async function createFilter(field, regex, directorId) {
  const fid = `f_${field}_${Date.now()}`;
  const cf = await fetchJson(`${BASE}/api/filters`, { method: 'POST', headers, body: JSON.stringify({ id: fid, field, regex, directorId }) });
  assert.strictEqual(cf.ok, true);
  return fid;
}

async function seedSettingsWithApiConfigHttp() {
  const cfgId = `cfg_${Date.now()}`;
  const put = await fetchJson(`${BASE}/api/settings`, {
    method: 'PUT',
    headers,
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

async function seedPromptHttp() {
  const pid = `p_${Date.now()}`;
  const cp = await fetchJson(`${BASE}/api/prompts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: pid, name: 'Dir Prompt', messages: [{ role: 'system', content: 'You are a director.' }] })
  });
  assert.strictEqual(cp.ok, true);
  return pid;
}

async function createDirectorHttp(apiConfigId, promptId, suffix) {
  const did = `d_${suffix}_${Date.now()}`;
  const cd = await fetchJson(`${BASE}/api/directors`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: did, name: `Dir ${suffix}`, apiConfigId, promptId })
  });
  assert.strictEqual(cd.ok, true);
  return did;
}

async function ensureAccountGmailHttp() {
  const accId = `acc_${Date.now()}@example.com`;
  const expiry = new Date(Date.now() + 3600 * 1000).toISOString();
  const body = {
    id: accId,
    provider: 'gmail',
    email: accId,
    signature: '',
    tokens: { accessToken: 'test-access-token', refreshToken: 'test-refresh-token', expiry }
  };
  const ca = await fetchJson(`${BASE}/api/accounts`, { method: 'POST', headers, body: JSON.stringify(body) });
  assert.strictEqual(ca.ok, true);
}

async function listConversations() {
  const r = await fetchJson(`${BASE}/api/conversations?limit=1000&offset=0`, { headers });
  assert.strictEqual(r.ok, true);
  return r.data.items;
}

test('Live: recipient field filters (to/cc) trigger directors', async () => {
  const before = await listConversations();
  let dirSubjectId;
  let dirToId;
  let dirCcId;
  if (IN_PROCESS) {
    const apiConfig = await fixtures.ensureApiConfig({ model: 'gpt-4o-mini', fetcherAutoStart: false });
    const prompt = await fixtures.ensurePrompt({
      name: 'Dir Prompt',
      messages: [{ role: 'system', content: 'You are a director.' }],
    });
    const dirSubject = await fixtures.ensureDirector({ apiConfigId: apiConfig.id, promptId: prompt.id, name: 'Dir subject' });
    const dirTo = await fixtures.ensureDirector({ apiConfigId: apiConfig.id, promptId: prompt.id, name: 'Dir to' });
    const dirCc = await fixtures.ensureDirector({ apiConfigId: apiConfig.id, promptId: prompt.id, name: 'Dir cc' });

    await createFilter('subject', 'E2E TEST', dirSubject.id);
    await createFilter('to', 'recipient@example.com', dirTo.id);
    await createFilter('cc', 'manager@example.com', dirCc.id);

    await fixtures.ensureAccount({ provider: 'gmail', signature: '', email: `acc-${Date.now()}@example.com` });
    dirSubjectId = dirSubject.id;
    dirToId = dirTo.id;
    dirCcId = dirCc.id;
  } else {
    const cfgId = await seedSettingsWithApiConfigHttp();
    const pid = await seedPromptHttp();
    dirSubjectId = await createDirectorHttp(cfgId, pid, 'subject');
    dirToId = await createDirectorHttp(cfgId, pid, 'to');
    dirCcId = await createDirectorHttp(cfgId, pid, 'cc');

    await createFilter('subject', 'E2E TEST', dirSubjectId);
    await createFilter('to', 'recipient@example.com', dirToId);
    await createFilter('cc', 'manager@example.com', dirCcId);

    await ensureAccountGmailHttp();
  }

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
  assert.ok(byDir.has(dirSubjectId), 'subject filter did not trigger');
  assert.ok(byDir.has(dirToId), 'to filter did not trigger');
  assert.ok(byDir.has(dirCcId), 'cc filter did not trigger');
});
