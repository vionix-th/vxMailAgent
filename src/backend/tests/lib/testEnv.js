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
  createTestEnv,
};
