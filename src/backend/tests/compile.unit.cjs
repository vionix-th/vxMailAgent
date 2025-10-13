const { test, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { applyTestEnvDefaults } = require('./lib/env.cjs');

applyTestEnvDefaults();

after(() => {
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
    const orchestrator = new ConversationOrchestrator(userReq, 'run-test', 'acct-test');
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
      getSettings: async () => ({ fetcherAutoStart: false, apiConfigs: [] }),
      getFetcherLog: async () => [],
      appendFetcherLog: async () => {},
      replaceFetcherLog: async () => {},
      clearFetcherLog: async () => {},
      deleteFetcherLog: async () => false,
      deleteFetcherLogs: async () => 0,
      getFilters: async () => [],
      getDirectors: async () => [],
      getAgents: async () => [],
      getPrompts: async () => [],
      getEmails: async () => [],
      upsertEmails: async () => {},
      deleteEmail: async () => false,
      clearEmails: async () => {},
      getConversations: async () => [],
      setConversations: async () => {},
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
