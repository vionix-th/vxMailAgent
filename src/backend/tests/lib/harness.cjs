const crypto = require('node:crypto');

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
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
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

module.exports = { signJwt, createAuthHeaders, fetchJson, withHeartbeat, logEvent };

