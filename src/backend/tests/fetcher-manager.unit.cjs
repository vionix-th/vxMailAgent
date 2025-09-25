const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

test('fetcher-manager: creates fetcher and evicts idle by TTL', async () => {
  // Ensure config is read with small TTL (1 minute)
  process.env.DISABLE_DOTENV = 'true';
  process.env.FETCHER_MANAGER_TTL_MINUTES = '1';
  const fmPath = path.join(__dirname, '..', 'dist', 'backend', 'services', 'fetcher-manager.js');
  delete require.cache[require.resolve(fmPath)];
  const { FetcherManager } = require(fmPath);

  // Minimal repos to satisfy initFetcher
  const repos = {
    getFetcherLog: async () => [],
    appendFetcherLog: async () => {},
    replaceFetcherLog: async () => {},
    clearFetcherLog: async () => {},
    deleteFetcherLog: async () => false,
    deleteFetcherLogs: async () => 0,
    getSettings: async () => ({ apiConfigs: [] }),
    getFilters: async () => [],
    getDirectors: async () => [],
    getAgents: async () => [],
    getAccounts: async () => [],
    getPrompts: async () => [],
    getEmails: async () => [],
    upsertEmails: async () => {},
    deleteEmail: async () => false,
    clearEmails: async () => {},
    getConversations: async () => [],
    setConversations: async () => {},
  };
  const fm = new FetcherManager(repos);
  const req = { userContext: { uid: 'u1', repos: {} } };
  // Create fetcher entry
  fm.getFetcher(req);
  // Force lastAccessed far in the past (now - 61k)
  const map = fm["fetchers"];
  for (const [uid, entry] of map.entries()) {
    entry.lastAccessed = Date.now() - 61000;
  }
  // Run cleanup; should evict entries
  fm.cleanup();
  assert.strictEqual(map.size === 0 || map.size < 1, true);
  // Clear cleanup timer to avoid open handle keeping test process alive
  if (fm["cleanupTimer"]) {
    try { clearInterval(fm["cleanupTimer"]); } catch {}
  }
});
