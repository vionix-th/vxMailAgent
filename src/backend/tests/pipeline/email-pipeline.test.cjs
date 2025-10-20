const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  discoverTestUser,
  startBackend,
  createSession,
  fetchJson,
  waitFor,
} = require('../lib/harness');
const { createTestEnv, TEST_TIMEOUTS } = require('../lib/testEnv');

const { uid } = discoverTestUser();

async function listConversations(baseUrl, headers) {
  const res = await fetchJson(baseUrl, '/api/conversations?limit=200&offset=0', { headers });
  if (!res.ok) {
    throw new Error(`GET /api/conversations failed: ${JSON.stringify(res.data)}`);
  }
  return Array.isArray(res.data?.items) ? res.data.items : [];
}

function ensureNonEmpty(collection, label, instruction) {
  if (!Array.isArray(collection) || collection.length === 0) {
    const hint = instruction ? ` — ${instruction}` : '';
    throw new Error(`[pipeline] ${label} missing for test user ${uid}${hint}`);
  }
}

test('pipeline uses pre-seeded configuration to complete director and agent flow', { concurrency: false, timeout: TEST_TIMEOUTS.node.short }, async () => {
  const startTimestamp = Date.now();
  const { baseUrl, stop } = await startBackend({
    env: createTestEnv({
      VX_TEST_MOCK_PROVIDER: 'true',
      VX_TEST_DISABLE_ORCHESTRATOR: 'true',
    }),
  });
  const { headers: sessionHeaders } = await createSession(baseUrl, uid);
  const authHeaders = (extra = {}) => ({ ...sessionHeaders, ...extra });

  let fetcherTriggered = false;

  try {
    const [settingsRes, directorsRes, agentsRes, filtersRes, accountsRes] = await Promise.all([
      fetchJson(baseUrl, '/api/settings', { headers: sessionHeaders }),
      fetchJson(baseUrl, '/api/directors', { headers: sessionHeaders }),
      fetchJson(baseUrl, '/api/agents', { headers: sessionHeaders }),
      fetchJson(baseUrl, '/api/filters', { headers: sessionHeaders }),
      fetchJson(baseUrl, '/api/accounts', { headers: sessionHeaders }),
    ]);

    if (!settingsRes.ok) throw new Error(`GET /api/settings failed: ${JSON.stringify(settingsRes.data)}`);
    const apiConfigs = Array.isArray(settingsRes.data?.apiConfigs) ? settingsRes.data.apiConfigs : [];
    ensureNonEmpty(apiConfigs, 'API configuration', 'provision an API config for the test user via Settings');

    if (!directorsRes.ok) throw new Error(`GET /api/directors failed: ${JSON.stringify(directorsRes.data)}`);
    const directors = Array.isArray(directorsRes.data) ? directorsRes.data : [];
    ensureNonEmpty(directors, 'Director list', 'create a director assigned to at least one agent');

    if (!agentsRes.ok) throw new Error(`GET /api/agents failed: ${JSON.stringify(agentsRes.data)}`);
    const agents = Array.isArray(agentsRes.data) ? agentsRes.data : [];
    ensureNonEmpty(agents, 'Agent list', 'create an agent and assign it to the director');

    if (!filtersRes.ok) throw new Error(`GET /api/filters failed: ${JSON.stringify(filtersRes.data)}`);
    const filters = Array.isArray(filtersRes.data) ? filtersRes.data : [];
    ensureNonEmpty(filters, 'Filter list', 'add a filter targeting the director used for pipeline tests');

    if (!accountsRes.ok) throw new Error(`GET /api/accounts failed: ${JSON.stringify(accountsRes.data)}`);
    const accounts = Array.isArray(accountsRes.data) ? accountsRes.data : [];
    ensureNonEmpty(accounts, 'Linked mail account', 'connect at least one mailbox for the test user');

    const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
    const directorWithAgent = directors.find((director) => Array.isArray(director.agentIds) && director.agentIds.some((id) => agentsById.has(id)));
    if (!directorWithAgent) {
      throw new Error('[pipeline] No director has an assigned agent; update the director configuration for the test user');
    }
    const filterForDirector = filters.find((filter) => filter.directorId === directorWithAgent.id);
    if (!filterForDirector) {
      throw new Error(`[pipeline] No filter points to director ${directorWithAgent.id}; add one so the fetcher can trigger orchestration`);
    }

    const beforeThreads = await listConversations(baseUrl, sessionHeaders);
    const beforeIds = new Set(beforeThreads.map((thread) => thread.id));

    const runRes = await fetchJson(baseUrl, '/api/fetcher/run', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }) });
    if (!runRes.ok) {
      throw new Error(`/api/fetcher/run failed: ${JSON.stringify(runRes.data)}`);
    }
    fetcherTriggered = true;

    let directorThread;
    let agentThread;
    try {
      ({ directorThread, agentThread } = await waitFor(async () => {
        const items = await listConversations(baseUrl, sessionHeaders);
        const recent = items.filter((thread) => {
          const startedAt = Date.parse(thread.startedAt ?? thread.createdAt ?? '') || 0;
          return startedAt >= startTimestamp - 1000;
        });
        const newOnes = recent.filter((thread) => !beforeIds.has(thread.id));
        const director = newOnes.find((thread) => thread.kind === 'director' && thread.status === 'completed');
        if (!director) return null;
        const agent = items.find((thread) => thread.kind === 'agent' && thread.parentId === director.id && thread.status === 'completed');
        if (!agent) return null;
        return { directorThread: director, agentThread: agent };
      }, { timeoutMs: TEST_TIMEOUTS.wait.standard, intervalMs: 250 }));
    } catch (err) {
      throw new Error(`[pipeline] Fetcher did not produce a completed director+agent conversation within 10s — verify filters, linked account, and mock provider configuration. (${err?.message || err})`);
    }

    assert.ok(directorThread, 'Expected a completed director thread');
    assert.ok(agentThread, 'Expected a completed agent thread');
    assert.strictEqual(agentThread.parentId, directorThread.id, 'Agent thread parent mismatch');

    const agentMessages = Array.isArray(agentThread.messages) ? agentThread.messages : [];
    assert.ok(agentMessages.length > 0, 'Agent thread messages missing');
    const agentAssistant = agentMessages[agentMessages.length - 1];
    assert.strictEqual(agentAssistant.role, 'assistant', 'Agent final message must be assistant role');

    const detailsRes = await fetchJson(baseUrl, `/api/conversations/${directorThread.id}/details`, { headers: sessionHeaders });
    if (!detailsRes.ok) {
      throw new Error(`GET /api/conversations/${directorThread.id}/details failed: ${JSON.stringify(detailsRes.data)}`);
    }
    const orchestrationEvents = Array.isArray(detailsRes.data?.orchestrationEvents) ? detailsRes.data.orchestrationEvents : [];
    assert.ok(orchestrationEvents.length > 0, 'Expected orchestration events for pipeline run');

    const providerEvents = await fetchJson(baseUrl, `/api/conversations/${directorThread.id}/provider-events`, { headers: sessionHeaders });
    if (!providerEvents.ok) {
      throw new Error(`GET /api/conversations/${directorThread.id}/provider-events failed: ${JSON.stringify(providerEvents.data)}`);
    }
    const events = Array.isArray(providerEvents.data) ? providerEvents.data : [];
    assert.ok(events.length > 0, 'Expected provider events for pipeline run');
    assert.ok(events.some((event) => event.type === 'request'), 'Expected at least one provider request event');
  } finally {
    if (fetcherTriggered) {
      try {
        await fetchJson(baseUrl, '/api/fetcher/stop', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }) });
      } catch (error) {
        console.warn('[pipeline] failed to stop fetcher during cleanup', error);
      }
    }
    await stop();
  }
});
