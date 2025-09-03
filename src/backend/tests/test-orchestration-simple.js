// Direct test of orchestration trigger in EmailProcessor
const path = require('path');

// Simple test to isolate the orchestration issue
async function testOrchestrationTrigger() {
  console.log('Testing orchestration trigger directly...');
  
  let orchestrationCalled = false;
  
  // Test the setImmediate pattern used in EmailProcessor
  console.log('1. Testing setImmediate async pattern...');
  
  setImmediate(async () => {
    try {
      console.log('2. setImmediate callback executed');
      
      // Simulate orchestration call
      await new Promise(resolve => setTimeout(resolve, 10));
      orchestrationCalled = true;
      console.log('3. Mock orchestration completed');
      
    } catch (error) {
      console.error('4. Error in setImmediate:', error.message);
    }
  });
  
  console.log('5. setImmediate scheduled, continuing...');
  
  // Wait for async execution
  await new Promise(resolve => setTimeout(resolve, 100));
  
  console.log('\nResults:');
  console.log('- setImmediate executed:', orchestrationCalled ? '✓' : '✗');
  
  if (!orchestrationCalled) {
    console.log('\n❌ setImmediate pattern failed - this explains the orchestration issue');
    return false;
  }
  
  // Now test the actual orchestration integration
  console.log('\n6. Testing actual EmailProcessor integration...');
  
  try {
    // Import the compiled EmailProcessor
    const { EmailProcessor } = require('./dist/backend/services/email-processor');
    
    let loggedEvents = [];
    const logFetch = (entry) => {
      loggedEvents.push(entry);
      console.log('Log event:', entry.event);
    };
    
    // Mock minimal repos
    const mockRepos = {
      getConversations: async () => [],
      setConversations: async (req, conversations) => {
        console.log('7. Thread persisted:', conversations[0]?.id);
      }
    };
    
    const processor = new EmailProcessor(mockRepos, logFetch);
    
    // Test createDirectorThread directly
    const envelope = {
      id: 'test-123',
      subject: 'Test',
      from: 'test@test.com',
      date: new Date().toISOString(),
      snippet: 'test',
      bodyPlain: 'test',
      bodyHtml: 'test',
      attachments: []
    };
    
    const context = {
      account: { id: 'acc1', provider: 'gmail' },
      prompts: [{ id: 'p1', messages: [{ role: 'system', content: 'test' }] }],
      apiConfigs: [{ id: 'c1', name: 'test', apiKey: 'test' }],
      agents: []
    };
    
    const director = { id: 'd1', promptId: 'p1', apiConfigId: 'c1' };
    const userReq = { userContext: { uid: 'u1', repos: mockRepos } };
    
    // Call createDirectorThread method directly
    const threadId = await processor.createDirectorThread(director, envelope, context, 'trace1', userReq);
    
    console.log('8. createDirectorThread returned:', threadId);
    
    // Wait for setImmediate orchestration
    await new Promise(resolve => setTimeout(resolve, 200));
    
    const orchestrationErrors = loggedEvents.filter(e => e.event === 'orchestration_error');
    
    console.log('\nFinal Results:');
    console.log('- Thread created:', threadId ? '✓' : '✗');
    console.log('- Orchestration errors:', orchestrationErrors.length);
    
    if (orchestrationErrors.length > 0) {
      console.log('- Error details:', orchestrationErrors[0].detail);
      console.log('\n❌ Orchestration failed with error');
      return false;
    }
    
    console.log('\n✅ No orchestration errors detected');
    return true;
    
  } catch (error) {
    console.error('Test error:', error.message);
    console.error('Stack:', error.stack);
    return false;
  }
}

testOrchestrationTrigger().then(success => {
  console.log('\n' + (success ? '✅ Test passed' : '❌ Test failed'));
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
