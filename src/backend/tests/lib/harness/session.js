const fs = require('fs');
const path = require('path');
const { dataUsersRoot } = require('./paths');
const { requestWithTimeout } = require('./http');

function discoverTestUser(rootDir = dataUsersRoot) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(rootDir, entry.name, '.testuser');
    if (fs.existsSync(candidate)) {
      const sanitized = entry.name;
      const match = sanitized.match(/^([^_]+)_(.+)$/);
      const uid = match ? `${match[1]}:${match[2]}` : sanitized;
      return { uid, fsPath: path.join(rootDir, sanitized) };
    }
  }
  throw new Error('No test user discovered. Add a `.testuser` marker under data/users/<uid>/');
}

async function createSession(baseUrl, uid, info = {}) {
  const res = await requestWithTimeout(baseUrl, '/api/test/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid, ...info }),
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { throw new Error(`Invalid JSON from /api/test/session: ${text}`); }
  }
  if (!res.ok) {
    throw new Error(`/api/test/session failed: ${res.status} ${JSON.stringify(data)}`);
  }
  const token = data?.token;
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('Session route did not return a token');
  }
  const setCookie = res.headers.get('set-cookie');
  let cookie;
  if (setCookie) {
    cookie = setCookie.split(';')[0];
  }
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  headers.Authorization = `Bearer ${token}`;
  return { token, cookie, headers };
}

module.exports = { discoverTestUser, createSession };

