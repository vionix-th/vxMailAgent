const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

test('toolCalls: describe_tool returns parameters for core tools', async () => {
  const mod = require(path.join(__dirname, '..', 'dist', 'backend', 'toolCalls.js'));
  const repo = (items=[]) => ({
    list: async () => items.slice(),
    getById: async (id) => items.find((item) => item.id === id) ?? null,
  });
  const repos = {
    agents: repo([]),
    directors: repo([]),
    conversations: repo([]),
    prompts: repo([]),
    settings: {
      load: async () => ({ apiConfigs: [] }),
      save: async () => {},
      delete: async () => {},
    },
    workspaceItems: {
      list: async () => [],
      listByConversation: async () => [],
    },
    memory: {
      list: async () => [],
    },
  };
  const handle = mod.createToolHandler(repos);
  const out = await handle('describe_tool', { name: 'workspace_add_item' });
  assert.ok(out.success);
  assert.ok(out.result && out.result.parameters);
});
