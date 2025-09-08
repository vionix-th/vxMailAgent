const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// This smoke test validates the orchestrator contract without hitting real OpenAI.
// It monkey-patches the compiled engine to return deterministic tool_calls and messages.

test('Orchestrator contract: director tool_calls -> agent run -> director follow-up', async () => {
  // Load compiled modules
  const backendRoot = path.resolve(__dirname, '..');
  const distRoot = path.join(backendRoot, 'dist');
  // Prefer dist/backend/services (newer build), fall back to dist/services
  const candidates = [
    path.join(distRoot, 'backend', 'services'),
    path.join(distRoot, 'services'),
  ];
  const base = candidates.find(d => fs.existsSync(path.join(d, 'engine.js')) && fs.existsSync(path.join(d, 'conversation-orchestrator.js')));
  if (!base) throw new Error('Could not locate compiled services in dist');
  const engineMod = require(path.join(base, 'engine.js'));
  const { ConversationOrchestrator } = require(path.join(base, 'conversation-orchestrator.js'));

  // Monkey-patch conversationEngine.run
  const originalRun = engineMod.conversationEngine.run;
  let callSeq = [];
  let callCount = 0;
  engineMod.conversationEngine.run = async (input) => {
    callSeq.push({ role: input.role });
    callCount++;
    const mk = (assistant, toolCalls=[]) => ({
      messages: [...input.messages, assistant],
      assistantMessage: assistant,
      toolCalls,
      request: { provider: 'openai', mock: true },
      response: { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, mock: true },
    });
    if (callCount === 1 && input.role === 'director') {
      const tc = { id: 'tc1', name: 'agent__a1', arguments: JSON.stringify({ input: 'do work' }) };
      const assistant = { role: 'assistant', content: null, tool_calls: [{ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } }] };
      return mk(assistant, [tc]);
    }
    if (callCount === 2 && input.role === 'agent') {
      const assistant = { role: 'assistant', content: 'agent done' };
      return mk(assistant, []);
    }
    // final director assistant
    const assistant = { role: 'assistant', content: 'final' };
    return mk(assistant, []);
  };

  try {
    // Minimal LiveRepos implementation for conversations
    let conversations = [];
    const repos = {
      async getConversations() { return conversations; },
      async setConversations(_req, next) { conversations = next; },
    };

    // Mock RepoBundle for req-aware repositories
    const providerEvents = [];
    const workspaceItems = [];
    const req = {
      userContext: {
        uid: 'u1',
        repos: {
          providerEvents: { append: async (e) => { providerEvents.push(e); }, getAll: async () => providerEvents, setAll: async (n) => { providerEvents.splice(0, providerEvents.length, ...n); } },
          orchestrationLog: { getAll: async () => [], setAll: async (_n) => {} },
          traces: { append: async (_t) => {}, update: async (_id, _fn) => {}, getAll: async () => [] },
          workspaceItems: { getAll: async () => workspaceItems.slice(), setAll: async (n) => { workspaceItems.splice(0, workspaceItems.length, ...n); } },
        },
      },
    };

    // req-aware loggers compatible with both constructor signatures
    const logProviderEvent = (ev) => {
      // minimal append into provider events repo
      return req.userContext.repos.providerEvents.append(ev);
    };
    const logOrch = (_entry) => {
      // no-op for now; could push into orchestrationLog.setAll
    };

    // Seed minimal director + agent + prompts + apiConfig
    const director = { id: 'd1', name: 'Dir', promptId: 'pD', apiConfigId: 'cfg' };
    const agent = { id: 'a1', name: 'Agent', type: 'openai', promptId: 'pA', apiConfigId: 'cfg' };
    const prompts = [
      { id: 'pD', name: 'Director', messages: [{ role: 'system', content: 'You are a director.' }] },
      { id: 'pA', name: 'Agent', messages: [{ role: 'system', content: 'You are an agent.' }] },
    ];
    const apiConfigs = [{ id: 'cfg', name: 'Mock', apiKey: 'mock', model: 'mock' }];

    // Create initial director thread
    const dirThread = {
      id: 'tD', kind: 'director', directorId: director.id, promptId: director.promptId, apiConfigId: director.apiConfigId,
      email: { id: 'e1', subject: 'S', from: 'x@y', date: new Date().toISOString() },
      startedAt: new Date().toISOString(), status: 'ongoing', lastActiveAt: new Date().toISOString(),
      messages: prompts.find(p => p.id === 'pD').messages.slice(), errors: [], finalized: false,
    };
    conversations = [dirThread];

    // Try 4-arg (old) then 3-arg (new) signature
    let orch;
    try {
      orch = new ConversationOrchestrator(repos, logProviderEvent, logOrch, req);
    } catch (e) {
      orch = new ConversationOrchestrator(repos, logOrch, req);
    }

    let updated;
    try {
      updated = await orch.runConversationLoop({
        thread: dirThread,
        agents: [agent],
        apiConfigs,
        prompts,
        traceId: 'trace-1',
      }, req, 5);
    } catch (err) {
      // If constructor mapping was wrong, retry with a fresh instance using the other signature
      orch = new ConversationOrchestrator(repos, logOrch, req);
      updated = await orch.runConversationLoop({
        thread: dirThread,
        agents: [agent],
        apiConfigs,
        prompts,
        traceId: 'trace-1',
      }, req, 5);
    }

    // Assertions
    assert.strictEqual(updated.id, 'tD');
    const finalDir = (await repos.getConversations()).find(c => c.id === 'tD');
    assert.ok(finalDir, 'Director thread missing');
    const toolMsg = finalDir.messages.find(m => m.role === 'tool' && m.tool_call_id === 'tc1');
    assert.ok(toolMsg, 'Director tool result not injected');
    const lastMsg = finalDir.messages[finalDir.messages.length - 1];
    assert.strictEqual(lastMsg.role, 'assistant');
    assert.strictEqual(lastMsg.content, 'final');

    const agentThread = (await repos.getConversations()).find(c => c.kind === 'agent' && c.parentId === 'tD');
    assert.ok(agentThread, 'Agent thread not created');
    const agentLast = agentThread.messages[agentThread.messages.length - 1];
    assert.strictEqual(agentLast.role, 'assistant');
    assert.strictEqual(agentLast.content, 'agent done');

    assert.ok(providerEvents.length >= 2, 'Provider events should be logged');
  } finally {
    // restore
    engineMod.conversationEngine.run = originalRun;
  }
});
