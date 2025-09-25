const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Verify logging handlers append to repos (no lossy read+set races)
test('Logging: orchestration and provider append semantics', async () => {
  // Load compiled handlers (ensure `npm run build` was executed before this test)
  const candidates = [
    path.join(__dirname, '..', 'dist', 'backend', 'services'),
    path.join(__dirname, '..', 'dist', 'services'),
  ];
  const base = candidates.find((p) => {
    try { require.resolve(path.join(p, 'logging-handlers.js')); return true; } catch { return false; }
  });
  if (!base) throw new Error('Could not locate compiled services for logging-handlers');
  const handlers = require(path.join(base, 'logging-handlers.js'));

  // In-memory repositories (append-only)
  const orchestration = [];
  const providerEvents = [];
  const req = {
    userContext: {
      uid: 'test-user',
      repos: {
        orchestrationLog: {
          append: async (e) => { orchestration.push(e); },
          list: async () => orchestration.slice(),
          replace: async (n) => { orchestration.splice(0, orchestration.length, ...n); },
          clear: async () => { orchestration.splice(0, orchestration.length); },
        },
        providerEvents: {
          append: async (e) => { providerEvents.push(e); },
          list: async () => providerEvents.slice(),
          replace: async (n) => { providerEvents.splice(0, providerEvents.length, ...n); },
          clear: async () => { providerEvents.splice(0, providerEvents.length); },
        },
      },
    },
  };

  // Orchestration entries: concurrent appends
  const N = 20;
  await Promise.all(Array.from({ length: N }, (_, i) => {
    return Promise.resolve().then(() => handlers.logOrchestrationStart(`d-${i}`, `email-${i}`, req));
  }));
  const orchList = await req.userContext.repos.orchestrationLog.list();
  assert.strictEqual(orchList.length, N, 'orchestration log should have N entries');
  assert.ok(orchList.every(e => e.phase === 'director'), 'orchestration entries must be director phase');

  // Provider events via class wrapper
  const pel = new handlers.ProviderEventLogger(req);
  pel.logRequest('c-1', { foo: 'bar' });
  pel.logResponse('c-1', 123, { ok: true }, { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 });
  const provList = await req.userContext.repos.providerEvents.list();
  assert.strictEqual(provList.length, 2, 'provider events should have 2 entries');
  assert.strictEqual(provList[0].type, 'request');
  assert.strictEqual(provList[1].type, 'response');
});
