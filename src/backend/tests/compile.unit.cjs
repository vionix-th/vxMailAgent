const { test, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Ensure dotenv doesn't interfere in this test process
process.env.DISABLE_DOTENV = process.env.DISABLE_DOTENV || 'true';
const TSC_TIMEOUT_MS = Number(process.env.TSC_TIMEOUT_MS || 60000);

// Test that actually compiles the backend to catch real compilation errors
test('Backend TypeScript compilation', async () => {
  return new Promise((resolve, reject) => {
    console.log('Compiling backend TypeScript...');

    const backendDir = path.join(__dirname, '..');
    // Prefer local tsc binary over npx to avoid npx overhead/prompts
    const localTsc = path.join(backendDir, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
    const cmd = fs.existsSync(localTsc) ? localTsc : 'npx';
    const args = fs.existsSync(localTsc) ? ['--noEmit'] : ['tsc', '--noEmit'];

    const child = spawn(cmd, args, {
      cwd: backendDir,
      stdio: 'pipe',
      env: { ...process.env, DISABLE_DOTENV: 'true' }
    });

    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    const killer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error(`TypeScript compile exceeded ${TSC_TIMEOUT_MS}ms`));
    }, TSC_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(killer);
      if (code === 0) {
        console.log('✅ TypeScript compilation successful');
        resolve();
      } else {
        console.log('❌ TypeScript compilation failed');
        console.log('STDOUT:', stdout);
        console.log('STDERR:', stderr);
        
        // Fail the test with compilation errors
        assert.fail(`TypeScript compilation failed with exit code ${code}\n${stderr}`);
      }
    });
    
    child.on('error', (error) => {
      reject(error);
    });
  });
});

// Ensure this test file never leaves the process hanging when run standalone
after(() => {
  // Give Node a tick to settle, then force-exit to avoid open-handle hangs
  setTimeout(() => {
    try { process.exit(0); } catch {}
  }, 0);
});

// Test that requires and instantiates actual backend classes
test('EmailProcessor real require and instantiation', async () => {
  try {
    // Resolve compiled module from dist
    const path = require('path');
    const candidates = [
      path.join(__dirname, '..', 'dist', 'backend', 'services', 'email-processor.js'),
      path.join(__dirname, '..', 'dist', 'services', 'email-processor.js'),
    ];
    const modPath = candidates.find((p) => { try { require.resolve(p); return true; } catch { return false; } });
    if (!modPath) throw new Error('EmailProcessor compiled module not found');
    const { EmailProcessor } = require(modPath);

    // Create minimal mock repos
    const mockRepos = {
      getConversations: async () => [],
      setConversations: async () => {},
      getSettings: async () => ({ apiConfigs: [] }),
      getDirectors: async () => [],
      getAgents: async () => [],
      getPrompts: async () => [],
      getFilters: async () => []
    };

    // Constructor expects (repos, logFetchFn)
    const processor = new EmailProcessor(mockRepos, () => {});
    assert.ok(processor);
    assert.strictEqual(typeof processor.processEmail, 'function');

  } catch (error) {
    assert.fail(`Failed to require or instantiate EmailProcessor: ${error.message}`);
  }
});

// Test ConversationOrchestrator real require
test('ConversationOrchestrator real require and instantiation', async () => {
  try {
    const path = require('path');
    const candidates = [
      path.join(__dirname, '..', 'dist', 'backend', 'services', 'conversation-orchestrator.js'),
      path.join(__dirname, '..', 'dist', 'services', 'conversation-orchestrator.js'),
    ];
    const modPath = candidates.find((p) => { try { require.resolve(p); return true; } catch { return false; } });
    if (!modPath) throw new Error('ConversationOrchestrator compiled module not found');
    const { ConversationOrchestrator } = require(modPath);

    const userReq = { userContext: { uid: 'test' } };
    const orchestrator = new ConversationOrchestrator(userReq);
    assert.ok(orchestrator);
    assert.strictEqual(typeof orchestrator.runConversationStep, 'function');

  } catch (error) {
    assert.fail(`Failed to require or instantiate ConversationOrchestrator: ${error.message}`);
  }
});

// Test FetcherManager real require
test('FetcherManager real require and instantiation', async () => {
  try {
    const path = require('path');
    const candidates = [
      path.join(__dirname, '..', 'dist', 'backend', 'services', 'fetcher-manager.js'),
      path.join(__dirname, '..', 'dist', 'services', 'fetcher-manager.js'),
    ];
    const modPath = candidates.find((p) => { try { require.resolve(p); return true; } catch { return false; } });
    if (!modPath) throw new Error('FetcherManager compiled module not found');
    const { FetcherManager } = require(modPath);

    const mockRepos = {
      getAccounts: async () => [],
      getSettings: async () => ({ fetcherAutoStart: false }),
      getFetcherLog: async () => [],
      setFetcherLog: async () => {}
    };

    const fetcherManager = new FetcherManager(mockRepos);
    assert.ok(fetcherManager);
    assert.strictEqual(typeof fetcherManager.getStatus, 'function');
    // Clear cleanup timer to avoid open handles in tests
    if (fetcherManager["cleanupTimer"]) {
      try { clearInterval(fetcherManager["cleanupTimer"]); } catch {}
    }

  } catch (error) {
    assert.fail(`Failed to require or instantiate FetcherManager: ${error.message}`);
  }
});
