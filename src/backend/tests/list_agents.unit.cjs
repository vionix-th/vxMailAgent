const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

test('toolCalls: list_agents filters by director roster', async () => {
  const mod = require(path.join(__dirname, '..', 'dist', 'backend', 'toolCalls.js'));
  const repo = (items=[]) => ({ getAll: async () => items.slice(), setAll: async (n) => { items.splice(0, items.length, ...n); } });
  const repos = {
    agents: repo([{ id: 'a1', name: 'A1', apiConfigId: 'cfg' }, { id: 'a2', name: 'A2', apiConfigId: 'cfg' }]),
    directors: repo([{ id: 'd1', name: 'D1', agentIds: ['a2'] }]),
    conversations: repo([]),
    prompts: repo([]),
    settings: repo([{ apiConfigs: [] }]),
    workspaceItems: repo([]),
    memory: repo([]),
  };
  const handle = mod.createToolHandler(repos);
  const all = await handle('list_agents', {});
  assert.ok(all.success);
  assert.strictEqual(all.result.length, 2);
  const filtered = await handle('list_agents', { directorId: 'd1' });
  assert.ok(filtered.success);
  assert.deepStrictEqual(filtered.result.map(a => a.id), ['a2']);
});

