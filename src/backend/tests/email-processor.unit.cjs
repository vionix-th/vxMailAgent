const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

test('email-processor: creates director thread on matching filter (no orchestration run)', async () => {
  // Locate compiled EmailProcessor
  const candidates = [
    path.join(__dirname, '..', 'dist', 'backend', 'services', 'email-processor.js'),
    path.join(__dirname, '..', 'dist', 'services', 'email-processor.js'),
  ];
  const modPath = candidates.find((p) => { try { require.resolve(p); return true; } catch { return false; } });
  if (!modPath) throw new Error('EmailProcessor compiled module not found');
  const { EmailProcessor } = require(modPath);

  // Stub orchestration kick-off to avoid background step
  const origStart = EmailProcessor.prototype.startDirectorOrchestration;
  EmailProcessor.prototype.startDirectorOrchestration = function() { /* no-op in unit test */ };

  try {
    let conversations = [];
    const repos = {
      getConversations: async () => conversations,
      setConversations: async (_req, next) => { conversations = next; },
    };
    const processor = new EmailProcessor(repos, () => {});

    const now = new Date().toISOString();
    const envelope = { id: 'e1', subject: 'Security alert', from: 'x@y', date: now, snippet: '...' };
    const context = {
      envelope,
      account: { id: 'acc1', provider: 'gmail' },
      traceId: 't1',
      fetchCycleId: 'fc1',
      filters: [{ id: 'f1', field: 'subject', regex: '.*', directorId: 'd1' }],
      directors: [{ id: 'd1', name: 'Dir', promptId: 'pD', apiConfigId: 'cfg' }],
      agents: [],
      prompts: [{ id: 'pD', name: 'Director', messages: [{ role: 'system', content: 'You are director' }] }],
      apiConfigs: [{ id: 'cfg', name: 'Mock', apiKey: 'k', model: 'gpt-4o-2024-08-06' }]
    };
    const req = { userContext: { uid: 'u1', repos: {} } };

    const result = await processor.processEmail(context, req);
    assert.strictEqual(result.success, true);
    assert.ok(conversations.length === 1, 'should create a director thread');
    assert.strictEqual(conversations[0].kind, 'director');
    assert.strictEqual(conversations[0].directorId, 'd1');
  } finally {
    // restore
    EmailProcessor.prototype.startDirectorOrchestration = origStart;
  }
});

