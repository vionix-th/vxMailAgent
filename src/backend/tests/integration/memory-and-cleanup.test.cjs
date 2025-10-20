const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  discoverTestUser,
  withServer,
  createSession,
  fetchJson,
  createLogCapture,
} = require('../lib/harness');
const { TEST_TIMEOUTS } = require('../lib/testEnv');
const { uid } = discoverTestUser();

function authHeaders(sessionHeaders, extra = {}) {
  return { ...sessionHeaders, ...extra };
}

test('integration: memory entries and cleanup routes', { concurrency: false, timeout: TEST_TIMEOUTS.node.standard }, async () => {
  await withServer(async ({ baseUrl }) => {
    const logCapture = createLogCapture();
    const { headers: sessionHeaders } = await createSession(baseUrl, uid);
    const jsonHeaders = authHeaders(sessionHeaders, { 'Content-Type': 'application/json' });

  const memoryIds = [];

  try {
    const statsBefore = await fetchJson(baseUrl, '/api/cleanup/stats', { headers: sessionHeaders });
    assert.strictEqual(statsBefore.ok, true, '/api/cleanup/stats (before) failed');
    assert.ok(typeof statsBefore.data.total === 'number', 'cleanup stats must expose numeric totals');

    const createEntry = await fetchJson(baseUrl, '/api/memory', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        scope: 'local',
        owner: uid,
        content: 'integration memory entry',
        tags: ['integration'],
        metadata: { origin: 'integration-suite' },
      }),
    });
    assert.strictEqual(createEntry.ok, true, 'memory creation failed');
    const createdId = createEntry.data.entry.id;
    memoryIds.push(createdId);

    const listByTag = await fetchJson(baseUrl, '/api/memory?tag=integration', { headers: sessionHeaders });
    assert.strictEqual(listByTag.ok, true, 'memory list by tag failed');
    assert.ok(Array.isArray(listByTag.data) && listByTag.data.some((entry) => entry.id === createdId), 'tag query should return created entry');
    const tagLog = await logCapture.waitFor((entry) => entry.message === 'GET /api/memory query' && entry.meta?.tag === 'integration', { timeoutMs: TEST_TIMEOUTS.wait.quick });
    assert.strictEqual(tagLog.meta.includeDeleted, false, 'memory query log should set includeDeleted=false');
    logCapture.drain();

    const scopedQuery = await fetchJson(baseUrl, `/api/memory?scope=local&owner=${encodeURIComponent(uid)}`, { headers: sessionHeaders });
    assert.strictEqual(scopedQuery.ok, true, 'scoped memory query failed');
    assert.ok(Array.isArray(scopedQuery.data) && scopedQuery.data.some((entry) => entry.id === createdId), 'scoped query should include created entry');
    const scopeLog = await logCapture.waitFor((entry) => entry.message === 'GET /api/memory query' && entry.meta?.scope === 'local' && entry.meta?.owner === uid, { timeoutMs: TEST_TIMEOUTS.wait.quick });
    assert.strictEqual(scopeLog.meta.includeDeleted, false, 'scoped log should mark includeDeleted=false');
    logCapture.drain();

    const updateEntry = await fetchJson(baseUrl, `/api/memory/${encodeURIComponent(createdId)}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ content: 'integration memory entry updated' }),
    });
    assert.strictEqual(updateEntry.ok, true, 'memory update failed');
    assert.strictEqual(updateEntry.data.entry.content, 'integration memory entry updated', 'memory content not updated');

    const addMetadata = await fetchJson(baseUrl, `/api/memory/${encodeURIComponent(createdId)}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ metadata: { note: 'transient' } }),
    });
    assert.strictEqual(addMetadata.ok, true, 'memory metadata update failed');
    assert.deepEqual(addMetadata.data.entry.metadata, { note: 'transient' }, 'metadata update not persisted');

    // Remove metadata by sending null (JSON cannot express undefined)
    const removeMetadata = await fetchJson(baseUrl, `/api/memory/${encodeURIComponent(createdId)}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ metadata: null }),
    });
    assert.strictEqual(removeMetadata.ok, true, 'memory metadata removal failed');
    assert.ok(typeof removeMetadata.data.entry.metadata === 'undefined', 'metadata should be removed when null is provided');

    const stripTags = await fetchJson(baseUrl, `/api/memory/${encodeURIComponent(createdId)}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ tags: [] }),
    });
    assert.strictEqual(stripTags.ok, true, 'memory tag removal failed');
    assert.ok(!Array.isArray(stripTags.data.entry.tags) || stripTags.data.entry.tags.length === 0, 'tags should be cleared when empty array provided');

    const searchUpdated = await fetchJson(baseUrl, '/api/memory?query=updated', { headers: sessionHeaders });
    assert.strictEqual(searchUpdated.ok, true, 'memory search by query failed');
    assert.ok(Array.isArray(searchUpdated.data) && searchUpdated.data.some((entry) => entry.id === createdId), 'query search should contain updated entry');

    const createSecond = await fetchJson(baseUrl, '/api/memory', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        id: `int-memory-${Date.now()}`,
        scope: 'local',
        owner: uid,
        content: 'integration secondary entry',
      }),
    });
    assert.strictEqual(createSecond.ok, true, 'second memory creation failed');
    memoryIds.push(createSecond.data.entry.id);

    const bulkDelete = await fetchJson(baseUrl, '/api/memory', {
      method: 'DELETE',
      headers: jsonHeaders,
      body: JSON.stringify({ ids: memoryIds.slice(1) }),
    });
    assert.strictEqual(bulkDelete.ok, true, 'bulk delete should succeed');

    const statsAfterWrites = await fetchJson(baseUrl, '/api/cleanup/stats', { headers: sessionHeaders });
    assert.strictEqual(statsAfterWrites.ok, true, '/api/cleanup/stats (after writes) failed');
    assert.ok(typeof statsAfterWrites.data.total === 'number', 'cleanup stats total should be numeric');

    const cleanupFetcherLogs = await fetchJson(baseUrl, '/api/cleanup/fetcher-logs', {
      method: 'DELETE',
      headers: jsonHeaders,
    });
    assert.strictEqual(cleanupFetcherLogs.ok, true, '/api/cleanup/fetcher-logs should succeed');
    assert.ok(typeof cleanupFetcherLogs.data.deleted === 'number', 'fetcher-logs response should include numeric deleted');

    const cleanupProviderEvents = await fetchJson(baseUrl, '/api/cleanup/provider-events', {
      method: 'DELETE',
      headers: jsonHeaders,
    });
    assert.strictEqual(cleanupProviderEvents.ok, true, '/api/cleanup/provider-events should succeed');
    assert.ok(typeof cleanupProviderEvents.data.deleted === 'number', 'provider-events response should include numeric deleted');

    const cleanupOrchLogs = await fetchJson(baseUrl, '/api/cleanup/orchestration-logs', {
      method: 'DELETE',
      headers: jsonHeaders,
    });
    assert.strictEqual(cleanupOrchLogs.ok, true, '/api/cleanup/orchestration-logs should succeed');
    assert.ok(typeof cleanupOrchLogs.data.deleted === 'number', 'orchestration-logs response should include numeric deleted');

    const cleanupConversations = await fetchJson(baseUrl, '/api/cleanup/conversations', {
      method: 'DELETE',
      headers: jsonHeaders,
    });
    assert.strictEqual(cleanupConversations.ok, true, '/api/cleanup/conversations should succeed');
    assert.ok(typeof cleanupConversations.data.deleted === 'number', 'conversations response should include numeric deleted');

    const cleanupWorkspaceItems = await fetchJson(baseUrl, '/api/cleanup/workspace-items', {
      method: 'DELETE',
      headers: jsonHeaders,
    });
    assert.strictEqual(cleanupWorkspaceItems.ok, true, '/api/cleanup/workspace-items should succeed');
    assert.ok(typeof cleanupWorkspaceItems.data.deleted === 'number', 'workspace-items response should include numeric deleted');

    const cleanupTraces = await fetchJson(baseUrl, '/api/cleanup/traces', {
      method: 'DELETE',
      headers: jsonHeaders,
    });
    assert.strictEqual(cleanupTraces.ok, true, '/api/cleanup/traces should succeed');
    assert.ok(typeof cleanupTraces.data.deleted === 'number', 'traces response should include numeric deleted');

    const cleanupAll = await fetchJson(baseUrl, '/api/cleanup/all', {
      method: 'DELETE',
      headers: jsonHeaders,
    });
    assert.strictEqual(cleanupAll.ok, true, '/api/cleanup/all should succeed');
    assert.ok(typeof cleanupAll.data.deleted.total === 'number', 'cleanup all response should include totals');

    } finally {
      logCapture.stop();
    }
  });
});
