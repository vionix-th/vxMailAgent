const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

test('email-fetcher: processes one envelope via mock provider (no orchestration run)', async () => {
  process.env.DISABLE_DOTENV = 'true';
  process.env.TRACE_PERSIST = 'false';
  process.env.VX_TEST_MOCK_PROVIDER = 'true';
  // Patch EmailProcessor to prevent background orchestration
  const epCandidates = [
    path.join(__dirname, '..', 'dist', 'backend', 'services', 'email-processor.js'),
    path.join(__dirname, '..', 'dist', 'services', 'email-processor.js'),
  ];
  const epPath = epCandidates.find((p) => { try { require.resolve(p); return true; } catch { return false; } });
  if (!epPath) throw new Error('EmailProcessor compiled module not found');
  const epMod = require(epPath);
  const origStart = epMod.EmailProcessor.prototype.startDirectorOrchestration;
  epMod.EmailProcessor.prototype.startDirectorOrchestration = function() {};

  const efCandidates = [
    path.join(__dirname, '..', 'dist', 'backend', 'services', 'email-fetcher.js'),
    path.join(__dirname, '..', 'dist', 'services', 'email-fetcher.js'),
  ];
  const efPath = efCandidates.find((p) => { try { require.resolve(p); return true; } catch { return false; } });
  if (!efPath) throw new Error('EmailFetcher compiled module not found');
  const { EmailFetcher } = require(efPath);

  try {
    // In-memory repos and req (with traces stub since beginTrace resolves repo regardless of TRACE_PERSIST)
    let conversations = [];
    const repos = {
      getConversations: async () => conversations,
      setConversations: async (_req, next) => { conversations = next; },
      getSettings: async () => ({ apiConfigs: [{ id: 'cfg', name: 'Mock', apiKey: 'k', model: 'gpt-4o-2024-08-06' }] }),
      getDirectors: async () => [{ id: 'd1', name: 'Dir', promptId: 'pD', apiConfigId: 'cfg' }],
      getAgents: async () => [],
      getPrompts: async () => [{ id: 'pD', name: 'Director', messages: [{ role: 'system', content: 'You are director' }] }],
    };
    const req = { userContext: { uid: 'u1', repos: { traces: { append: async () => {}, update: async () => {}, getAll: async () => [], setAll: async () => {} } } } };
    const log = [];
    const fetcher = new EmailFetcher(repos, (e) => log.push(e));

    const fc = {
      userReq: req,
      settings: await repos.getSettings(req),
      filters: [{ id: 'f1', field: 'subject', regex: '.*', directorId: 'd1' }],
      directors: await repos.getDirectors(req),
      agents: await repos.getAgents(req),
      accounts: [{ id: 'acc1', provider: 'gmail' }]
    };

    await fetcher.fetchEmails(fc);
    assert.ok(log.find(e => e.event === 'fetch_cycle_start'));
    assert.ok(conversations.length === 1, 'should create one director conversation');
  } finally {
    // restore
    epMod.EmailProcessor.prototype.startDirectorOrchestration = origStart;
  }
});
