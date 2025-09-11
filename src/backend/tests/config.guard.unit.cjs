const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

function loadConfigFresh() {
  const p = path.join(__dirname, '..', 'dist', 'backend', 'config.js');
  delete require.cache[require.resolve(p)];
  return require(p);
}

test('config: getGoogleOAuthConfig fails when missing', () => {
  process.env.DISABLE_DOTENV = 'true';
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REDIRECT_URI;
  const cfg = loadConfigFresh();
  assert.throws(() => cfg.getGoogleOAuthConfig(), /Missing required environment variable: GOOGLE_CLIENT_ID/);
});

test('config: getGoogleOAuthConfig succeeds when present', () => {
  process.env.DISABLE_DOTENV = 'true';
  process.env.GOOGLE_CLIENT_ID = 'cid';
  process.env.GOOGLE_CLIENT_SECRET = 'sec';
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost/cb';
  const cfg = loadConfigFresh();
  const out = cfg.getGoogleOAuthConfig();
  assert.strictEqual(out.clientId, 'cid');
  assert.strictEqual(out.clientSecret, 'sec');
  assert.strictEqual(out.redirectUri, 'http://localhost/cb');
});
