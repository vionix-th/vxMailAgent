const { test } = require('node:test');
const assert = require('node:assert');

test('Debug EmailProcessor instantiation error', async () => {
  try {
    // Build first
    const { spawn } = require('child_process');
    const buildResult = await new Promise((resolve) => {
      const child = spawn('npx', ['tsc'], {
        cwd: require('path').join(__dirname, '..'),
        stdio: 'pipe'
      });
      
      child.on('close', (code) => {
        resolve({ code });
      });
    });
    
    if (buildResult.code !== 0) {
      console.log('Build failed, skipping test');
      return;
    }
    
    console.log('Attempting to require EmailProcessor...');
    const { EmailProcessor } = require('../dist/services/email-processor');
    console.log('EmailProcessor class:', typeof EmailProcessor);
    console.log('EmailProcessor constructor:', EmailProcessor.toString().substring(0, 200));
    
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
    
    console.log('Creating EmailProcessor instance...');
    console.log('mockRepos type:', typeof mockRepos);
    console.log('mockServices type:', typeof mockServices);
    
    const emailProcessor = new EmailProcessor(mockRepos, mockServices);
    console.log('EmailProcessor created:', typeof emailProcessor);
    console.log('processEmails method:', typeof emailProcessor.processEmails);
    
    if (typeof emailProcessor.processEmails !== 'function') {
      console.log('Available methods:', Object.getOwnPropertyNames(emailProcessor));
      console.log('Prototype methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(emailProcessor)));
    }
    
  } catch (error) {
    console.log('Full error:', error);
    console.log('Error stack:', error.stack);
    throw error;
  }
});

