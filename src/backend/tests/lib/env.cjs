function resolveTestUserId() {
  if (typeof process.env.VX_TEST_USER_ID === 'string' && process.env.VX_TEST_USER_ID.trim() !== '') {
    return process.env.VX_TEST_USER_ID.trim();
  }

  const paths = require('./test-user-discovery.cjs');
  const discovered = paths.discoverTestUserId();
  if (!discovered) {
    throw new Error('VX_TEST_USER_ID required: set the env var or add a .testuser marker under data/users/<uid>/');
  }
  process.env.VX_TEST_USER_ID = discovered;
  return discovered;
}

const DEFAULT_TEST_ENV = Object.freeze({
  DISABLE_DOTENV: 'true',
  NODE_ENV: process.env.NODE_ENV || 'test',
  VX_TEST_MOCK_OPENAI: process.env.VX_TEST_MOCK_OPENAI || 'true',
  VX_TEST_MOCK_PROVIDER: process.env.VX_TEST_MOCK_PROVIDER || 'true',
  TRACE_PERSIST: process.env.TRACE_PERSIST || 'false',
  VX_TEST_REQUEST_TIMEOUT_MS: process.env.VX_TEST_REQUEST_TIMEOUT_MS || '10000',
  VX_TEST_IN_PROCESS_SERVER: process.env.VX_TEST_IN_PROCESS_SERVER || 'true',
  JWT_SECRET: process.env.JWT_SECRET || 'test-jwt-secret-0123456789-test-value',
  JWT_EXPIRES_IN_SEC: process.env.JWT_EXPIRES_IN_SEC || '3600',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || 'test-google-client-id',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || 'test-google-client-secret',
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || 'https://example.com/oauth/google',
  OUTLOOK_CLIENT_ID: process.env.OUTLOOK_CLIENT_ID || 'test-outlook-client-id',
  OUTLOOK_CLIENT_SECRET: process.env.OUTLOOK_CLIENT_SECRET || 'test-outlook-client-secret',
  OUTLOOK_REDIRECT_URI: process.env.OUTLOOK_REDIRECT_URI || 'https://example.com/oauth/outlook',
});

function applyTestEnvDefaults() {
  const uid = resolveTestUserId();
  process.env.VX_TEST_USER_ID = uid;
  for (const [key, value] of Object.entries(DEFAULT_TEST_ENV)) {
    if (value === undefined) continue;
    const existing = process.env[key];
    if (typeof existing === 'string' && existing.trim() !== '') continue;
    process.env[key] = value;
  }
  process.env.DISABLE_DOTENV = 'true';
}

module.exports = {
  DEFAULT_TEST_ENV,
  applyTestEnvDefaults,
  resolveTestUserId,
};
