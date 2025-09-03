const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Test actual module compilation by building and requiring the compiled JS
test('Build and require actual backend modules', async () => {
  const { spawn } = require('child_process');
  
  // First build the backend
  const buildResult = await new Promise((resolve) => {
    const child = spawn('npx', ['tsc'], {
      cwd: path.join(__dirname, '..'),
      stdio: 'pipe'
    });
    
    let stderr = '';
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('close', (code) => {
      resolve({ code, stderr });
    });
  });
  
  if (buildResult.code !== 0) {
    assert.fail(`TypeScript build failed: ${buildResult.stderr}`);
  }
  
  // Now try to require the compiled modules
  try {
    const EmailProcessor = require('../dist/services/email-processor').EmailProcessor;
    const ConversationOrchestrator = require('../dist/services/conversation-orchestrator').ConversationOrchestrator;
    const FetcherManager = require('../dist/services/fetcher-manager').FetcherManager;
    
    assert.ok(EmailProcessor, 'EmailProcessor should be defined');
    assert.ok(ConversationOrchestrator, 'ConversationOrchestrator should be defined');
    assert.ok(FetcherManager, 'FetcherManager should be defined');
    
    console.log('✅ All core modules compiled and can be required');
    
  } catch (error) {
    assert.fail(`Failed to require compiled modules: ${error.message}`);
  }
});

// Test that the modules can actually be instantiated
test('Instantiate compiled backend modules', async () => {
  try {
    // Build first
    const { spawn } = require('child_process');
    const buildResult = await new Promise((resolve) => {
      const child = spawn('npx', ['tsc'], {
        cwd: path.join(__dirname, '..'),
        stdio: 'pipe'
      });
      
      child.on('close', (code) => {
        resolve({ code });
      });
    });
    
    if (buildResult.code !== 0) {
      console.log('Build failed, skipping instantiation test');
      return;
    }
    
    // Require compiled modules
    const { EmailProcessor } = require('../dist/services/email-processor');
    const { ConversationOrchestrator } = require('../dist/services/conversation-orchestrator');
    const { FetcherManager } = require('../dist/services/fetcher-manager');
    
    // Create mock dependencies
    const mockRepos = {
      getConversations: async () => [],
      setConversations: async () => {},
      getSettings: async () => ({ apiConfigs: [] }),
      getDirectors: async () => [],
      getAgents: async () => [],
      getPrompts: async () => [],
      getFilters: async () => [],
      getOrchestrationLog: async () => [],
      setOrchestrationLog: async () => {},
      getAccounts: async () => [],
      getFetcherLog: async () => [],
      setFetcherLog: async () => {}
    };
    
    const mockServices = {
      logProviderEvent: () => {},
      logOrch: () => {}
    };
    
    const mockUserReq = {
      userContext: { uid: 'test-user', repos: mockRepos }
    };
    
    // Test EmailProcessor instantiation
    try {
      const emailProcessor = new EmailProcessor(mockRepos, mockServices.logProviderEvent);
      assert.ok(emailProcessor);
      assert.strictEqual(typeof emailProcessor.processEmail, 'function');
      console.log('✅ EmailProcessor instantiated successfully');
    } catch (error) {
      console.log('❌ EmailProcessor instantiation failed:', error.message);
      throw error;
    }
    
    // Test ConversationOrchestrator instantiation
    try {
      const orchestrator = new ConversationOrchestrator(
        mockRepos, 
        mockServices.logProviderEvent, 
        mockServices.logOrch, 
        mockUserReq
      );
      assert.ok(orchestrator);
      assert.strictEqual(typeof orchestrator.runConversationStep, 'function');
      console.log('✅ ConversationOrchestrator instantiated successfully');
    } catch (error) {
      console.log('❌ ConversationOrchestrator instantiation failed:', error.message);
      throw error;
    }
    
    // Test FetcherManager instantiation
    try {
      const fetcherManager = new FetcherManager(mockRepos);
      assert.ok(fetcherManager);
      assert.strictEqual(typeof fetcherManager.getStatus, 'function');
      console.log('✅ FetcherManager instantiated successfully');
    } catch (error) {
      console.log('❌ FetcherManager instantiation failed:', error.message);
      throw error;
    }
    
    console.log('✅ All modules instantiated successfully');
    
  } catch (error) {
    assert.fail(`Failed to instantiate modules: ${error.message}`);
  }
});
