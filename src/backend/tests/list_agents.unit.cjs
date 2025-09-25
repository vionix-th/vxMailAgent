const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

test('toolCalls: list_agents filters by director roster', async () => {
  const mod = require(path.join(__dirname, '..', 'dist', 'backend', 'toolCalls.js'));
  const repo = (items=[]) => ({ list: async () => items.slice() });
  const repos = {
    agents: repo([{ id: 'a1', name: 'A1', apiConfigId: 'cfg' }, { id: 'a2', name: 'A2', apiConfigId: 'cfg' }]),
    directors: repo([{ id: 'd1', name: 'D1', agentIds: ['a2'] }]),
    conversations: { list: async () => [], getById: async () => null, insert: async () => {}, update: async () => {}, delete: async () => false },
    prompts: repo([]),
    settings: {
      load: async () => ({ apiConfigs: [] }),
      save: async () => {},
      delete: async () => {},
    },
    workspaceItems: { list: async () => [], listByConversation: async () => [] },
    memory: { list: async () => [] },
  };
  const handle = mod.createToolHandler(repos);
  const all = await handle('list_agents', {});
  assert.ok(all.success);
  assert.strictEqual(all.result.length, 2);
  const filtered = await handle('list_agents', { directorId: 'd1' });
  assert.ok(filtered.success);
  assert.deepStrictEqual(filtered.result.map(a => a.id), ['a2']);
});
