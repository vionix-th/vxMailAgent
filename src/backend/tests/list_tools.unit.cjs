const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

test('toolCalls: list_tools returns mandatory + enabled optional (no dynamic agent tools)', async () => {
  const mod = require(path.join(__dirname, '..', 'dist', 'backend', 'toolCalls.js'));
  const shared = require(path.join(__dirname, '..', 'dist', 'shared', 'tools.js'));
  const repo = (items=[]) => ({ list: async () => items.slice() });
  const repos = {
    agents: repo([{ id: 'a1', name: 'A1', apiConfigId: 'cfg' }]),
    directors: repo([{ id: 'd1', name: 'D1', enabledOptionalTools: ['memory_add'] }]),
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
  const out = await handle('list_tools', { directorId: 'd1' });
  assert.ok(out.success);
  const names = out.result.map(t => t.name);
  // includes mandatory tools
  const mandatory = shared.TOOL_REGISTRY.filter(t => t.category === 'mandatory').map(t => t.name);
  mandatory.forEach(m => assert.ok(names.includes(m), `missing mandatory: ${m}`));
  // includes explicitly enabled optional
  assert.ok(names.includes('memory_add'));
  // does not include unrelated optional
  assert.ok(!names.includes('calendar_add'));
  // no dynamic agent__ tools
  assert.ok(names.every(n => !n.startsWith('agent__')));
});
