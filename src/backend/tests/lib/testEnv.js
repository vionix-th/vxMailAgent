const TEST_TIMEOUTS = Object.freeze({
  node: Object.freeze({
    short: 15_000,
    standard: 20_000,
    extended: 25_000,
  }),
  http: Object.freeze({
    quick: 2_000,
    default: 3_000,
    medium: 8_000,
    long: 10_000,
    fetcher: 15_000,
  }),
  wait: Object.freeze({
    quick: 2_000,
    short: 5_000,
    medium: 8_000,
    standard: 10_000,
    extended: 12_000,
    long: 15_000,
  }),
});

const BASE_TEST_ENV = Object.freeze({
  VX_TEST_MOCK_PROVIDER: 'false',
  VX_TEST_DISABLE_ORCHESTRATOR: 'false',
  VX_TEST_OPENAI_STUB: 'false',
  VX_TEST_FORCE_OPENAI_ERROR: '',
  VX_TEST_FORCE_WORKSPACE_TOOLCALL: 'false',
  VX_TEST_WORKSPACE_AGENT_ID: 'int-workspace-agent',
});

function createTestEnv(overrides = {}) {
  return { ...BASE_TEST_ENV, ...overrides };
}

module.exports = {
  BASE_TEST_ENV,
  TEST_TIMEOUTS,
  createTestEnv,
};
