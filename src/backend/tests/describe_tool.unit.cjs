const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

test('toolCalls: describe_tool returns parameters for core tools', async () => {
  const mod = require(path.join(__dirname, '..', 'dist', 'backend', 'toolCalls.js'));
  const repo = (items=[]) => ({ getAll: async () => items.slice(), setAll: async (n) => { items.splice(0, items.length, ...n); } });
  const repos = {
    agents: repo([]),
    directors: repo([]),
    conversations: repo([]),
    prompts: repo([]),
    settings: repo([{ apiConfigs: [] }]),
    workspaceItems: repo([]),
    memory: repo([]),
  };
  const handle = mod.createToolHandler(repos);
  const out = await handle('describe_tool', { name: 'workspace_add_item' });
  assert.ok(out.success);
  assert.ok(out.result && out.result.parameters);
});

