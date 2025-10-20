const { TEST_TIMEOUTS } = require('../testEnv');

async function requestWithTimeout(baseUrl, pathSuffix, init = {}, timeoutMs = TEST_TIMEOUTS.http.default) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Request to ${pathSuffix} timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    // eslint-disable-next-line no-undef
    return await fetch(`${baseUrl}${pathSuffix}`, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(baseUrl, pathSuffix, init = {}, { timeoutMs = TEST_TIMEOUTS.http.default } = {}) {
  const res = await requestWithTimeout(baseUrl, pathSuffix, init, timeoutMs);
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new Error(`Failed to parse JSON from ${pathSuffix}: ${error.message}\nResponse: ${text}`);
    }
  }
  return { status: res.status, ok: res.ok, data };
}

module.exports = {
  requestWithTimeout,
  fetchJson,
};
