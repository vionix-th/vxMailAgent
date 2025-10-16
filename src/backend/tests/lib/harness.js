const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const dotenv = require('dotenv');

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}

const backendRoot = path.resolve(__dirname, '..', '..');
const distRoot = path.join(backendRoot, 'dist/backend');
const dataUsersRoot = path.resolve(backendRoot, '..', '..', 'data/users');

function requireBackend(relativePath) {
  return require(path.join(distRoot, relativePath));
}

async function requestWithTimeout(baseUrl, pathSuffix, init = {}, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Request to ${pathSuffix} timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    return await fetch(`${baseUrl}${pathSuffix}`, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

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

async function startBackend() {
  const originalCwd = process.cwd();
  process.chdir(backendRoot);
  dotenv.config({ path: path.join(backendRoot, '.env') });
  const { resolveDataDir } = requireBackend('utils/paths.js');
  const sourceDataDir = resolveDataDir();
  if (!fs.existsSync(sourceDataDir) || !fs.statSync(sourceDataDir).isDirectory()) {
    throw new Error(`Resolved data directory missing at ${sourceDataDir}`);
  }
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vxmail-data-'));
  const tempDataDir = path.join(tempRoot, 'data');
  fs.cpSync(sourceDataDir, tempDataDir, { recursive: true, errorOnExist: false });

  const previousDataDir = process.env.VX_MAILAGENT_DATA_DIR;
  process.env.VX_MAILAGENT_DATA_DIR = tempDataDir;
  const { createServer } = requireBackend('server.js');
  const { shutdownRepos } = requireBackend('initRepos.js');
  const { app, fetcherManager } = createServer();
  const server = await new Promise((resolve, reject) => {
    const srv = http.createServer(app);
    srv.listen(0, '127.0.0.1', (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(srv);
    });
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : address;
  const baseUrl = `http://127.0.0.1:${port}`;

  const stop = async () => {
    let primaryError = null;
    try {
      await new Promise((resolve) => server.close(() => resolve()));
      if (fetcherManager?.cleanupTimer) {
        try {
          clearInterval(fetcherManager.cleanupTimer);
        } catch (error) {
          console.warn('[harness] failed to clear fetcher cleanup timer', error);
        }
      }
      try {
        await shutdownRepos();
      } catch (error) {
        console.warn('[harness] shutdownRepos failed', error);
      }
    } catch (error) {
      primaryError = error instanceof Error ? error : new Error(String(error));
    } finally {
      try {
        if (previousDataDir === undefined) {
          delete process.env.VX_MAILAGENT_DATA_DIR;
        } else {
          process.env.VX_MAILAGENT_DATA_DIR = previousDataDir;
        }
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch (error) {
        console.warn('[harness] failed to remove temp data root', error);
        if (!primaryError) {
          primaryError = error instanceof Error ? error : new Error(String(error));
        }
      }
      dotenv.config({ path: path.join(backendRoot, '.env') });
      process.chdir(originalCwd);
    }
    if (primaryError) {
      throw primaryError;
    }
  };

  return { baseUrl, stop, fetcherManager };
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

async function fetchJson(baseUrl, pathSuffix, init = {}, { timeoutMs = 3000 } = {}) {
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

async function waitFor(predicate, { timeoutMs = 10000, intervalMs = 200 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for condition');
}

module.exports = {
  discoverTestUser,
  startBackend,
  createSession,
  fetchJson,
  waitFor,
};
