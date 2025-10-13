const path = require('path');
const fs = require('fs');
const os = require('os');
const { applyTestEnvDefaults } = require('./env.cjs');

const distBackend = path.join(__dirname, '..', '..', 'dist', 'backend');

function requireBackend(relPath) {
  return require(path.join(distBackend, relPath));
}

function listen(app, { host, port }) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(server);
    });
  });
}

async function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

async function startTestServer(options = {}) {
  applyTestEnvDefaults();
  const host = options.host || '127.0.0.1';
  const port = options.port ?? 0;
  const cloneData = options.cloneData !== false && process.env.VX_TEST_CLONE_DATA !== 'false';

  const { createServer } = requireBackend('server.js');
  const { shutdownRepos } = requireBackend('initRepos.js');
  const { resolveDataDir } = requireBackend('utils/paths.js');

  const originalDataDir = process.env.VX_MAILAGENT_DATA_DIR;
  let tempDataDir;
  if (cloneData) {
    const sourceDir = options.sourceDataDir
      ? path.resolve(options.sourceDataDir)
      : resolveDataDir();
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vxmail-data-'));
    try {
      if (fs.existsSync(sourceDir)) {
        fs.cpSync(sourceDir, tempDataDir, { recursive: true, force: true });
      } else {
        fs.mkdirSync(path.join(tempDataDir, 'users'), { recursive: true, mode: 0o700 });
      }
    } catch (error) {
      console.warn('Test data copy failed; falling back to empty workspace', error);
    }
    process.env.VX_MAILAGENT_DATA_DIR = tempDataDir;
  }

  const { app, fetcherManager } = createServer();
  const server = await listen(app, { host, port });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const baseUrl = `http://${host}:${actualPort}`;
  const previousBackendUrl = process.env.BACKEND_URL;
  process.env.BACKEND_URL = baseUrl;

  let closed = false;
  async function stop() {
    if (closed) return;
    closed = true;
    try {
      await closeServer(server);
    } catch (error) {
      console.warn('Test server close error', error);
    }
    try {
      if (fetcherManager && fetcherManager.cleanupTimer) {
        clearInterval(fetcherManager.cleanupTimer);
      }
    } catch {}
    try {
      await shutdownRepos();
    } catch (error) {
      console.warn('Test repo shutdown error', error);
    }
    if (cloneData) {
      if (originalDataDir === undefined) {
        delete process.env.VX_MAILAGENT_DATA_DIR;
      } else {
        process.env.VX_MAILAGENT_DATA_DIR = originalDataDir;
      }
      if (tempDataDir) {
        try { fs.rmSync(tempDataDir, { recursive: true, force: true }); } catch {}
      }
    }
    if (previousBackendUrl === undefined) {
      delete process.env.BACKEND_URL;
    } else {
      process.env.BACKEND_URL = previousBackendUrl;
    }
  }

  return {
    baseUrl,
    port: actualPort,
    host,
    fetcherManager,
    dataDir: cloneData ? tempDataDir : (process.env.VX_MAILAGENT_DATA_DIR || null),
    stop,
    close: stop,
  };
}

module.exports = {
  startTestServer,
};
