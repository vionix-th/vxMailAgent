const crypto = require('node:crypto');

const DEFAULT_REQUEST_TIMEOUT_MS = Number(process.env.VX_TEST_REQUEST_TIMEOUT_MS || 10000);

function base64url(input) {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return b.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signJwt(payload, secret, expiresInSec = 1800) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const nowSec = Math.floor(Date.now() / 1000);
  const body = { ...payload, exp: nowSec + expiresInSec };
  const h = base64url(JSON.stringify(header));
  const p = base64url(JSON.stringify(body));
  const toSign = `${h}.${p}`;
  const sig = crypto.createHmac('sha256', secret).update(toSign).digest();
  return `${toSign}.${base64url(sig)}`;
}

function createAuthHeaders({ uid, jwtSecret, token }) {
  const bearer = token || signJwt({ uid }, jwtSecret);
  return { Authorization: `Bearer ${bearer}` };
}

async function fetchJson(url, opts = {}) {
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const signals = [];
  if (opts.signal) {
    signals.push(opts.signal);
  }
  signals.push(controller.signal);

  const signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);

  const timer = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    const res = await fetch(url, { ...opts, signal });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, ok: res.ok, data };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function withHeartbeat(promise, label = 'step', intervalMs = 1000) {
  const start = Date.now();
  process.stdout.write(`STATUS ${label}: started\n`);
  const t = setInterval(() => {
    const ms = Date.now() - start;
    process.stdout.write(`STATUS ${label}: running ${ms}ms\n`);
  }, intervalMs);
  const clear = () => clearInterval(t);
  return promise.finally(() => {
    clear();
    const dur = Date.now() - start;
    process.stdout.write(`STATUS ${label}: finished in ${dur}ms\n`);
  });
}

function logEvent(event) {
  // Human + machine readable line
  const line = { ts: new Date().toISOString(), ...event };
  console.log(`TEST_EVENT ${JSON.stringify(line)}`);
}

async function ensureBackendReady({
  baseUrl = process.env.BACKEND_URL || 'http://localhost:3001',
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  const target = baseUrl.replace(/\/$/, '');
  const url = `${target}/api/health`;
  const res = await fetchJson(url, { timeoutMs });
  if (!res.ok) {
    throw new Error(`Backend preflight failed: ${url} responded with status ${res.status}`);
  }
  return res;
}

module.exports = { signJwt, createAuthHeaders, fetchJson, withHeartbeat, logEvent, ensureBackendReady };
