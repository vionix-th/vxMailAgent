const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const distBackend = path.join(__dirname, '..', 'dist', 'backend');
const { initRepos } = require(path.join(distBackend, 'initRepos.js'));
const {
  getUserRepoBundle,
  repoBundleRegistry,
} = require(path.join(distBackend, 'repository', 'registry.js'));

function withTempDataDir(fn) {
  const originalDir = process.env.VX_MAILAGENT_DATA_DIR;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-sqlite-test-'));
  process.env.VX_MAILAGENT_DATA_DIR = tempDir;

  const cleanup = () => {
    try {
      repoBundleRegistry.destroy();
    } catch {}
    if (originalDir === undefined) {
      delete process.env.VX_MAILAGENT_DATA_DIR;
    } else {
      process.env.VX_MAILAGENT_DATA_DIR = originalDir;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  };

  return fn().finally(cleanup);
}

test('SQLite LiveRepos conversation mutation flows', async () => {
  await withTempDataDir(async () => {
    const liveRepos = initRepos();
    const uid = `test-user-${Date.now()}`;
    const bundle = await getUserRepoBundle(uid);
    const req = { userContext: { uid, repos: bundle } };

    const nowIso = new Date().toISOString();
    const conversation = {
      id: 'thread-1',
      kind: 'director',
      parentId: null,
      directorId: 'director-1',
      agentId: null,
      accountId: 'account-1',
      email: {
        id: 'email-1',
        subject: 'Subject',
        from: 'from@example.com',
        to: 'to@example.com',
        date: nowIso,
      },
      promptId: 'prompt-1',
      apiConfigId: 'config-1',
      status: 'ongoing',
      startedAt: nowIso,
      lastActiveAt: nowIso,
      endedAt: null,
      result: undefined,
      errors: undefined,
      messages: [],
    };

    await liveRepos.appendConversation(req, conversation);
    let stored = await liveRepos.getConversations(req);
    assert.strictEqual(stored.length, 1, 'conversation appended');

    await liveRepos.appendMessagesToConversation(req, conversation.id, [
      { id: 'msg-1', role: 'assistant', content: 'hello' },
    ]);
    stored = await liveRepos.getConversations(req);
    assert.strictEqual(stored[0].messages.length, 1, 'message appended');

    await liveRepos.finalizeThreadStatusAtomic(req, conversation.id, 'completed');
    stored = await liveRepos.getConversations(req);
    assert.strictEqual(stored[0].status, 'completed', 'status finalized');
    assert.ok(stored[0].endedAt, 'endedAt set');

    // Ensure append operations persist across a fresh read (new bundle instance)
    repoBundleRegistry.removeBundle(uid);
    const reloadedBundle = await getUserRepoBundle(uid);
    const reqReloaded = { userContext: { uid, repos: reloadedBundle } };
    const reloadedList = await liveRepos.getConversations(reqReloaded);
    assert.strictEqual(reloadedList.length, 1, 'conversation persisted to sqlite');
    assert.strictEqual(reloadedList[0].messages.length, 1, 'messages persisted to sqlite');
  });
});

test('Provider events remain isolated per user', async () => {
  await withTempDataDir(async () => {
    initRepos();

    const uidA = `user-a-${Date.now()}`;
    const uidB = `user-b-${Date.now()}`;

    const bundleA = await getUserRepoBundle(uidA);
    const bundleB = await getUserRepoBundle(uidB);

    const reqA = { userContext: { uid: uidA, repos: bundleA } };
    const reqB = { userContext: { uid: uidB, repos: bundleB } };

    const eventA1 = {
      id: 'ev-a-1',
      conversationId: 'conv-a',
      provider: 'openai',
      type: 'request',
      timestamp: new Date().toISOString(),
      latencyMs: 42,
      usage: { totalTokens: 10 },
    };
    const eventA2 = { ...eventA1, id: 'ev-a-2', type: 'response' };

    await bundleA.providerEvents.append(eventA1);
    await bundleA.providerEvents.append(eventA2);

    const storedA = await bundleA.providerEvents.getAll();
    assert.strictEqual(storedA.length, 2, 'user A events stored');

    const storedB = await bundleB.providerEvents.getAll();
    assert.strictEqual(storedB.length, 0, 'user B remains isolated');

    repoBundleRegistry.removeBundle(uidA);
    repoBundleRegistry.removeBundle(uidB);
  });
});
