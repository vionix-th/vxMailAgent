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
  const repo = (items=[]) => ({ getAll: async () => items.slice(), setAll: async (n) => { items.splice(0, items.length, ...n); } });
  const repos = {
    conversations: repo(conversations),
    directors: repo([director]),
    agents: repo([agent]),
    prompts: repo([
      { id: 'pD', name: 'Director', messages: [{ role: 'system', content: 'You are a director' }] },
      { id: 'pA', name: 'Agent', messages: [{ role: 'system', content: 'You are an agent' }] },
    ]),
    settings: repo([{ apiConfigs: [{ id: 'cfg', name: 'Mock', apiKey: 'mock', model: 'mock' }] }]),
    workspaceItems: repo([]),
    memory: repo([]),
  };

  const handle = mod.createToolHandler(repos);
  const res = await handle('delegate_to_agent', { agentId: 'a1', input: 'do work', conversationId: 'tD', directorId: 'd1' });
  assert.ok(res.success, res.error || 'delegate_to_agent failed');
  assert.ok(res.result && 'content' in res.result, 'delegate_to_agent missing content');
});

