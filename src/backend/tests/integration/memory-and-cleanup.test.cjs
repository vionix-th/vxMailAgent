const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  discoverTestUser,
  startBackend,
  createSession,
  fetchJson,
} = require('../lib/harness');
const { runSerial } = require('./lib/serial');

const { uid } = discoverTestUser();

function authHeaders(sessionHeaders, extra = {}) {
  return { ...sessionHeaders, ...extra };
}

test('integration: memory entries and cleanup routes', { concurrency: false, timeout: 20000 }, async () => {
  await runSerial(async () => {
    const { baseUrl, stop } = await startBackend();
    const { headers: sessionHeaders } = await createSession(baseUrl, uid);
    const jsonHeaders = authHeaders(sessionHeaders, { 'Content-Type': 'application/json' });

    const memoryIds = [];

    try {
    const createEntry = await fetchJson(baseUrl, '/api/memory', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        scope: 'local',
        owner: uid,
        content: 'integration memory entry',
        tags: ['integration'],
      }),
    });
    assert.strictEqual(createEntry.ok, true, 'memory creation failed');
    const createdId = createEntry.data.entry.id;
    memoryIds.push(createdId);

    const listEntries = await fetchJson(baseUrl, '/api/memory?tag=integration', { headers: sessionHeaders });
    assert.strictEqual(listEntries.ok, true, 'memory list failed');
    const fetched = Array.isArray(listEntries.data) && listEntries.data.find((entry) => entry.id === createdId);
    assert.ok(fetched, 'created memory entry missing from list');

    const updateEntry = await fetchJson(baseUrl, `/api/memory/${encodeURIComponent(createdId)}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ content: 'integration memory entry updated' }),
    });
    assert.strictEqual(updateEntry.ok, true, 'memory update failed');
    assert.strictEqual(updateEntry.data.entry.content, 'integration memory entry updated', 'memory content not updated');

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

    const cleanupRes = await fetchJson(baseUrl, '/api/cleanup/fetcher-logs', {
      method: 'DELETE',
      headers: jsonHeaders,
    });
    assert.strictEqual(cleanupRes.ok, true, '/api/cleanup/fetcher-logs should succeed');
    } finally {
      for (const id of memoryIds) {
        await fetch(`${baseUrl}/api/memory/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: sessionHeaders,
        }).catch(() => {});
      }
      await stop();
    }
  });
});
