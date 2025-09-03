const { EmailProcessor } = require('./dist/backend/services/email-processor');
const { ConversationOrchestrator } = require('./dist/backend/services/conversation-orchestrator');

// Simple test to verify orchestration integration
async function testOrchestration() {
  console.log('Testing orchestration integration...');
  
  let orchestrationCalled = false;
  let orchestrationError = null;
  
  // Mock repos
  const mockRepos = {
    getConversations: async () => [],
    setConversations: async (req, conversations) => {
      console.log('✓ Director thread created:', conversations[0]?.id);
    }
  };
  
  // Mock logging
  const logFetch = (entry) => {
    console.log('Log:', entry.event, entry.message);
    if (entry.event === 'orchestration_error') {
      orchestrationError = entry.detail;
    }
  };
  
  // Mock ConversationOrchestrator
  const OriginalOrchestrator = ConversationOrchestrator;
  function MockOrchestrator(repos, logProvider, logOrch) {
    this.runConversationStep = async (context, userReq) => {
      orchestrationCalled = true;
      console.log('✓ Orchestration triggered for thread:', context.thread.id);
      return { success: true, shouldContinue: false, updatedThread: context.thread };
    };
  }
  
  // Replace constructor temporarily
  global.ConversationOrchestrator = MockOrchestrator;
  
  const processor = new EmailProcessor(mockRepos, logFetch);
  
  const envelope = {
    id: 'test-email-123',
    subject: 'Test Email',
    from: 'test@example.com', 
    date: new Date().toISOString(),
    snippet: 'Test snippet',
    bodyPlain: 'Test body',
    bodyHtml: '<p>Test body</p>',
    attachments: []
  };

  const context = {
    account: { id: 'test-account', provider: 'gmail' },
    directors: [{ id: 'dir1', promptId: 'prompt1', apiConfigId: 'config-2' }],
    agents: [],
    prompts: [{ id: 'prompt1', messages: [{ role: 'system', content: 'test' }] }],
    apiConfigs: [{ id: 'config-2', name: 'Test', apiKey: 'test' }]
  };

  const userReq = {
    userContext: { uid: 'test-user', repos: mockRepos }
  };
  
  try {
    console.log('Processing email...');
    const result = await processor.processEmail(envelope, context, 'trace-123', userReq);
    
    console.log('Email processing result:', {
      success: result.success,
      conversationsCreated: result.conversationsCreated.length
    });
    
    // Wait for setImmediate orchestration trigger
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setTimeout(resolve, 200));
    
    console.log('\nTest Results:');
    console.log('- Director thread created:', result.conversationsCreated.length > 0 ? '✓' : '✗');
    console.log('- Orchestration triggered:', orchestrationCalled ? '✓' : '✗');
    console.log('- Orchestration error:', orchestrationError || 'None');
    
    if (!orchestrationCalled) {
      console.log('\n❌ ORCHESTRATION NOT TRIGGERED - This is the bug!');
      return false;
    } else {
      console.log('\n✅ Orchestration integration working correctly');
      return true;
    }
    
  } catch (error) {
    console.error('Test failed:', error.message);
    return false;
  } finally {
    // Restore original
    global.ConversationOrchestrator = OriginalOrchestrator;
  }
}

// Run test
testOrchestration().then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('Test error:', error);
  process.exit(1);
});
