const { TEST_TIMEOUTS } = require('../testEnv');

async function waitFor(predicate, { timeoutMs = TEST_TIMEOUTS.wait.standard, intervalMs = 200 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const value = await predicate();
    if (value) return value;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for condition');
}

module.exports = { waitFor };
