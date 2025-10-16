const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const dotenv = require('dotenv');
const { backendRoot, requireBackend } = require('./paths');
const { applyTestEnv } = require('./env');

async function startBackend() {
  if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';
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

  const restoreEnv = applyTestEnv({
    VX_MAILAGENT_DATA_DIR: tempDataDir,
    VX_TEST_MOCK_PROVIDER: 'true',
    VX_TEST_DISABLE_ORCHESTRATOR: 'true',
    VX_TEST_OPENAI_STUB: 'true',
  });

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
        try { clearInterval(fetcherManager.cleanupTimer); } catch {}
      }
      try { await shutdownRepos(); } catch (error) { console.warn('[harness] shutdownRepos failed', error); }
    } catch (error) {
      primaryError = error instanceof Error ? error : new Error(String(error));
    } finally {
      try {
        restoreEnv();
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch (error) {
        console.warn('[harness] failed to remove temp data root', error);
        if (!primaryError) primaryError = error instanceof Error ? error : new Error(String(error));
      }
      dotenv.config({ path: path.join(backendRoot, '.env') });
      process.chdir(originalCwd);
    }
    if (primaryError) throw primaryError;
  };

  return { baseUrl, stop, fetcherManager };
}

module.exports = { startBackend };

async function withServer(fn) {
  const ctx = await startBackend();
  try {
    return await fn(ctx);
  } finally {
    await ctx.stop();
  }
}

module.exports.withServer = withServer;
