const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

test('toolCalls: delegate_to_agent creates/uses agent thread and returns content', async () => {
  process.env.VX_TEST_MOCK_OPENAI = 'true';
  const mod = require(path.join(__dirname, '..', 'dist', 'backend', 'toolCalls.js'));
  const orchAgent = require(path.join(__dirname, '..', 'dist', 'backend', 'services', 'orchestration-agent.js'));

  // sanity exports
  assert.ok(typeof mod.createToolHandler === 'function');
  assert.ok(typeof orchAgent.ensureAgentThread === 'function');

  const now = new Date().toISOString();
  const email = { id: 'e1', subject: 's', from: 'x@y', date: now };
  const director = { id: 'd1', name: 'Dir', promptId: 'pD', apiConfigId: 'cfg' };
  const agent = { id: 'a1', name: 'Agent', type: 'openai', promptId: 'pA', apiConfigId: 'cfg' };
  const conversations = [
    { id: 'tD', kind: 'director', parentId: null, directorId: 'd1', agentId: null, status: 'ongoing', endedAt: null, email, promptId: 'pD', apiConfigId: 'cfg', startedAt: now, lastActiveAt: now, messages: [] },
  ];
  const makeListRepo = (items=[]) => ({ list: async () => items.slice() });
  const conversationRepo = {
    list: async () => conversations.slice(),
    getById: async (id) => conversations.find((c) => c.id === id) ?? null,
    insert: async (item) => { conversations.push(item); },
    update: async (item) => {
      const idx = conversations.findIndex((c) => c.id === item.id);
      if (idx === -1) throw new Error('Conversation not found');
      conversations[idx] = item;
    },
    delete: async (id) => {
      const idx = conversations.findIndex((c) => c.id === id);
      if (idx === -1) return false;
      conversations.splice(idx, 1);
      return true;
    },
  };
  const repos = {
    conversations: conversationRepo,
    directors: makeListRepo([director]),
    agents: makeListRepo([agent]),
    prompts: makeListRepo([
      { id: 'pD', name: 'Director', messages: [{ role: 'system', content: 'You are a director' }] },
      { id: 'pA', name: 'Agent', messages: [{ role: 'system', content: 'You are an agent' }] },
    ]),
    settings: {
      load: async () => ({ apiConfigs: [{ id: 'cfg', name: 'Mock', apiKey: 'mock', model: 'mock' }] }),
      save: async () => {},
      delete: async () => {},
    },
    workspaceItems: { list: async () => [], listByConversation: async () => [] },
    memory: { list: async () => [] },
  };

  const handle = mod.createToolHandler(repos);
  const res = await handle('delegate_to_agent', { agentId: 'a1', input: 'do work', conversationId: 'tD', directorId: 'd1' });
  assert.ok(res.success, res.error || 'delegate_to_agent failed');
  assert.ok(res.result && 'content' in res.result, 'delegate_to_agent missing content');
});
