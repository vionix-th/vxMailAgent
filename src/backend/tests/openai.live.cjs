const { test } = require('node:test');
const assert = require('node:assert');
const { createAuthHeaders, fetchJson } = require('./lib/harness.cjs');

const BASE = process.env.BACKEND_URL || 'http://localhost:3001';
const TEST_UID = process.env.VX_TEST_USER_ID || 'test-user';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-jwt';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const headers = { ...createAuthHeaders({ uid: TEST_UID, jwtSecret: JWT_SECRET }), 'Content-Type': 'application/json' };

test('OpenAI chat test endpoint (conditional)', async (t) => {
  if (!OPENAI_API_KEY) {
    t.skip('No OPENAI_API_KEY set; skipping OpenAI live test');
    return;
  }

  const cfgId = `cfg_${Date.now()}`;
  // Upsert settings with an ApiConfig
  const put = await fetchJson(`${BASE}/api/settings`, {
    method: 'PUT', headers,
    body: JSON.stringify({ virtualRoot: '', apiConfigs: [{ id: cfgId, name: 'OpenAI', provider: 'openai', apiKey: OPENAI_API_KEY, model: OPENAI_MODEL }] })
  });
  assert.strictEqual(put.ok, true);

  const chat = await fetchJson(`${BASE}/api/test/chat`, {
    method: 'POST', headers,
    body: JSON.stringify({ apiConfigId: cfgId, messages: [{ role: 'user', content: 'Reply with the word OK' }], toolChoice: 'none' })
  });
  assert.strictEqual(chat.ok, true);
  assert.ok(typeof chat.data?.content === 'string');
});

