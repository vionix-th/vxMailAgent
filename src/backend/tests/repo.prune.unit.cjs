const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

test('repo pruneItems: TTL and maxItems', () => {
  const fileRepos = require(path.join(__dirname, '..', 'dist', 'backend', 'repository', 'fileRepositories.js'));
  const { pruneItems } = fileRepos;
  const now = Date.now();
  const list = [
    { id: 1, ts: new Date(now - 1000).toISOString() },
    { id: 2, ts: new Date(now - 10).toISOString() },
    { id: 3, ts: new Date(now).toISOString() },
  ];
  // TTL 500ms -> drop the oldest (1000ms old)
  const prunedTtl = pruneItems(list, { ttlMs: 500, getTimestamp: (e) => e.ts });
  assert.ok(prunedTtl.some(x => x.id === 2) && prunedTtl.some(x => x.id === 3) && prunedTtl.length === 2);
  // Max items 2 -> keep last 2
  const prunedMax = pruneItems(list, { maxItems: 2 });
  assert.deepStrictEqual(prunedMax.map(x => x.id), [2,3]);
});

