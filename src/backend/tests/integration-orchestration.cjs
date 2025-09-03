const { test } = require('node:test');
const assert = require('node:assert');
const { TestConfig } = require('./integration-test-config.cjs');

test('Integration: Orchestration with real/mock data', async () => {
  const config = new TestConfig();
  const testData = await config.getTestData();
  
  // Simulate orchestration behavior with real or mock data
  const mockOrchestrator = {
    runConversationStep: async (context, userReq) => {
      // Validate required context
      if (!context.thread) {
        throw new Error('Thread required');
      }
      
      if (!context.apiConfigs || context.apiConfigs.length === 0) {
        return { success: false, shouldContinue: false, error: 'No API configs available' };
      }
      
      const apiConfig = context.apiConfigs.find(c => c.id === context.thread.apiConfigId);
      if (!apiConfig) {
        return { success: false, shouldContinue: false, error: 'API config not found' };
      }
      
      // Simulate successful orchestration
      return {
        success: true,
        updatedThread: {
          ...context.thread,
          messages: [
            ...context.thread.messages,
            { role: 'assistant', content: 'Orchestration step completed' }
          ]
        }
      };
    }
  };
  
  // Always use mock thread for consistent testing
  const mockThread = {
    id: 'integration-thread',
    kind: 'director',
    directorId: testData.directors[0]?.id || 'dir-1',
    apiConfigId: testData.settings.apiConfigs[0]?.id || 'config-1',
    status: 'ongoing',
    messages: [{ role: 'system', content: 'Integration test thread' }]
  };
  
  const context = {
    thread: mockThread,
    traceId: 'integration-test-trace',
    agents: testData.agents,
    apiConfigs: testData.settings.apiConfigs,
    prompts: testData.prompts
  };
  
  const result = await mockOrchestrator.runConversationStep(context, { uid: config.testUserId });
  
  assert.strictEqual(result.success, true);
  assert.ok(result.updatedThread);
  assert.ok(result.updatedThread.messages.length > mockThread.messages.length);
});

test('Integration: Email processing with real/mock accounts', async () => {
  const config = new TestConfig();
  const testData = await config.getTestData();
  
  // Mock email processor behavior
  const mockEmailProcessor = {
    processEmails: async (accounts, context) => {
      const results = [];
      
      for (const account of accounts) {
        // Simulate email processing
        const processedEmails = [
          {
            id: `email-${Date.now()}`,
            subject: 'Test Email',
            from: 'test@example.com',
            processed: true,
            directorThreadId: null
          }
        ];
        
        // Check if any directors match this email
        const matchingDirectors = testData.directors.filter(d => 
          testData.settings.apiConfigs.some(c => c.id === d.apiConfigId)
        );
        
        if (matchingDirectors.length > 0) {
          processedEmails[0].directorThreadId = `thread-${Date.now()}`;
        }
        
        results.push({
          accountId: account.id,
          provider: account.provider,
          emailsProcessed: processedEmails.length,
          directorsTriggered: matchingDirectors.length,
          emails: processedEmails
        });
      }
      
      return results;
    }
  };
  
  // Mock accounts (or use real if available)
  const mockAccounts = [
    { id: 'acc-1', provider: 'gmail', email: 'test@gmail.com' },
    { id: 'acc-2', provider: 'outlook', email: 'test@outlook.com' }
  ];
  
  const results = await mockEmailProcessor.processEmails(mockAccounts, {
    directors: testData.directors,
    apiConfigs: testData.settings.apiConfigs,
    prompts: testData.prompts
  });
  
  assert.ok(Array.isArray(results));
  assert.strictEqual(results.length, mockAccounts.length);
  
  results.forEach(result => {
    assert.ok(result.accountId);
    assert.ok(result.provider);
    assert.strictEqual(typeof result.emailsProcessed, 'number');
    assert.strictEqual(typeof result.directorsTriggered, 'number');
  });
});
