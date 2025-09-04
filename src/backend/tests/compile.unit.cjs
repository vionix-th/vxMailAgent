const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');

// Test that actually compiles the backend to catch real compilation errors
test('Backend TypeScript compilation', async () => {
  return new Promise((resolve, reject) => {
    console.log('Compiling backend TypeScript...');
    
    const child = spawn('npx', ['tsc', '--noEmit'], {
      cwd: path.join(__dirname, '..'),
      stdio: 'pipe'
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        console.log('✅ TypeScript compilation successful');
        resolve();
      } else {
        console.log('❌ TypeScript compilation failed');
        console.log('STDOUT:', stdout);
        console.log('STDERR:', stderr);
        
        // Fail the test with compilation errors
        assert.fail(`TypeScript compilation failed with exit code ${code}\n${stderr}`);
      }
    });
    
    child.on('error', (error) => {
      reject(error);
    });
  });
});

// Test that requires and instantiates actual backend classes
test('EmailProcessor real require and instantiation', async () => {
  try {
    // Use require to test actual module loading
    const { EmailProcessor } = require('../dist/services/email-processor');
    
    // Create minimal mock repos
    const mockRepos = {
      getConversations: async () => [],
      setConversations: async () => {},
      getSettings: async () => ({ apiConfigs: [] }),
      getDirectors: async () => [],
      getAgents: async () => [],
      getPrompts: async () => [],
      getFilters: async () => []
    };
    
    const mockServices = {
      logProviderEvent: () => {},
      logOrch: () => {}
    };
    
    // This will fail if there are actual import/constructor issues
    const processor = new EmailProcessor(mockRepos, mockServices);
    assert.ok(processor);
    assert.strictEqual(typeof processor.processEmails, 'function');
    
  } catch (error) {
    assert.fail(`Failed to require or instantiate EmailProcessor: ${error.message}`);
  }
});

// Test ConversationOrchestrator real require
test('ConversationOrchestrator real require and instantiation', async () => {
  try {
    const { ConversationOrchestrator } = require('../dist/services/conversation-orchestrator');
    
    const mockRepos = {
      getOrchestrationLog: async () => [],
      setOrchestrationLog: async () => {}
    };
    
    const logProvider = () => {};
    const logOrch = () => {};
    const userReq = { userContext: { uid: 'test' } };
    
    const orchestrator = new ConversationOrchestrator(mockRepos, logProvider, logOrch, userReq);
    assert.ok(orchestrator);
    assert.strictEqual(typeof orchestrator.runConversationStep, 'function');
    
  } catch (error) {
    assert.fail(`Failed to require or instantiate ConversationOrchestrator: ${error.message}`);
  }
});

// Test FetcherManager real require
test('FetcherManager real require and instantiation', async () => {
  try {
    const { FetcherManager } = require('../dist/services/fetcher-manager');
    
    const mockRepos = {
      getAccounts: async () => [],
      getSettings: async () => ({ fetcherAutoStart: false }),
      getFetcherLog: async () => [],
      setFetcherLog: async () => {}
    };
    
    // FetcherManager only takes repos, not services
    const fetcherManager = new FetcherManager(mockRepos);
    assert.ok(fetcherManager);
    assert.strictEqual(typeof fetcherManager.getStatus, 'function');
    
  } catch (error) {
    assert.fail(`Failed to require or instantiate FetcherManager: ${error.message}`);
  }
});
