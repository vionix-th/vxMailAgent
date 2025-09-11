const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

test('orchestration-agent: ensureAgentThread creation, reuse, and invalid config', () => {
  const mod = require(path.join(__dirname, '..', 'dist', 'backend', 'services', 'orchestration-agent.js'));
  const { ensureAgentThread } = mod;
  const now = new Date().toISOString();
  const dir = { id: 'd1', name: 'Dir' };
  const agent = { id: 'a1', name: 'Agent', promptId: 'pA', apiConfigId: 'cfg' };
  const email = { id: 'e1', subject: 's', from: 'x@y', date: now };
  const prompts = [{ id: 'pA', name: 'Agent', messages: [{ role: 'system', content: 'You are agent' }] }];
  const apiConfigs = [{ id: 'cfg' }];
  let conversations = [
    { id: 'tD', kind: 'director', parentId: null, directorId: 'd1', agentId: null, status: 'ongoing', endedAt: null, email, promptId: 'pD', apiConfigId: 'cfg', startedAt: now, lastActiveAt: now, messages: [] },
  ];
  // Create
  let out = ensureAgentThread(conversations, 'tD', dir, agent, email, prompts, apiConfigs, now, () => 'tA', 'trace', undefined);
  conversations = out.conversations;
  assert.strictEqual(out.isNew, true);
  assert.ok(out.agentThread && out.agentThread.kind === 'agent');
  // Reuse
  const out2 = ensureAgentThread(conversations, 'tD', dir, agent, email, prompts, apiConfigs, now, () => 'tB', 'trace', undefined);
  assert.strictEqual(out2.isNew, false);
  // Invalid config (missing prompt)
  assert.throws(() => ensureAgentThread(conversations, 'tD', dir, { ...agent, promptId: 'missing' }, email, prompts, apiConfigs, now, () => 'tX'));
});
