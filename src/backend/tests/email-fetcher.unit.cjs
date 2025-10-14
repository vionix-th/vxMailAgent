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
    let emails = [];
    const repos = {
      getConversations: async () => conversations,
      setConversations: async (_req, next) => { conversations = next; },
      getSettings: async () => ({ apiConfigs: [{ id: 'cfg', name: 'Mock', apiKey: 'k', model: 'gpt-4o-2024-08-06' }] }),
      getDirectors: async () => [{ id: 'd1', name: 'Dir', promptId: 'pD', apiConfigId: 'cfg' }],
      getAgents: async () => [],
      getPrompts: async () => [{ id: 'pD', name: 'Director', messages: [{ role: 'system', content: 'You are director' }] }],
      getEmails: async () => emails.slice(),
      upsertEmails: async (_req, next) => {
        for (const env of next) {
          const idx = emails.findIndex((e) => e.id === env.id);
          if (idx === -1) {
            emails.push(env);
          } else {
            emails[idx] = env;
          }
        }
      },
    };
    const req = { userContext: { uid: 'u1', repos: { traces: { append: async () => {}, update: async () => {}, list: async () => [], replace: async () => {}, clear: async () => {} } } } };
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

test('email-fetcher: clears timeout to avoid unhandled rejection when provider resolves', async () => {
  process.env.DISABLE_DOTENV = 'true';
  process.env.TRACE_PERSIST = 'false';
  process.env.VX_TEST_MOCK_PROVIDER = 'true';

  const efCandidates = [
    path.join(__dirname, '..', 'dist', 'backend', 'services', 'email-fetcher.js'),
    path.join(__dirname, '..', 'dist', 'services', 'email-fetcher.js'),
  ];
  const efPath = efCandidates.find((p) => { try { require.resolve(p); return true; } catch { return false; } });
  if (!efPath) throw new Error('EmailFetcher compiled module not found');
  const { EmailFetcher } = require(efPath);

  let emails = [];
  const repos = {
    getEmails: async () => emails.slice(),
    upsertEmails: async (_req, next) => { emails = next.slice(); },
    getSettings: async () => ({ apiConfigs: [{ id: 'cfg', name: 'Mock', apiKey: 'k', model: 'gpt-4o-2024-08-06' }] }),
    getDirectors: async () => [],
    getAgents: async () => [],
    getPrompts: async () => [],
    getConversations: async () => [],
    getOrchestrationLog: async () => [],
    getProviderEvents: async () => [],
  };
  const req = { userContext: { uid: 'u1' } };
  const log = [];
  const fetcher = new EmailFetcher(repos, (entry) => log.push(entry));

  const fc = {
    userReq: req,
    settings: await repos.getSettings(req),
    filters: [],
    directors: [],
    agents: [],
    accounts: [{ id: 'acc1', provider: 'gmail', tokens: {} }],
  };

  const unhandled = [];
  const onUnhandled = (reason) => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  try {
    await fetcher.fetchEmails(fc);
    // allow pending microtasks/next tick to trigger if a dangling rejection existed
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.strictEqual(unhandled.length, 0, 'no unhandled rejections expected');
    assert.ok(log.some((e) => e.event === 'messages_listed'));
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
});
