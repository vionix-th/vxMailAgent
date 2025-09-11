const { test } = require('node:test');
const assert = require('node:assert');

test('Debug EmailProcessor instantiation error', async () => {
  try {
    const path = require('path');
    console.log('Attempting to require EmailProcessor...');
    const candidates = [
      path.join(__dirname, '..', 'dist', 'backend', 'services', 'email-processor.js'),
      path.join(__dirname, '..', 'dist', 'services', 'email-processor.js'),
    ];
    const modPath = candidates.find((p) => { try { require.resolve(p); return true; } catch { return false; } });
    if (!modPath) throw new Error('EmailProcessor compiled module not found');
    const { EmailProcessor } = require(modPath);
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
    
    console.log('Creating EmailProcessor instance...');
    console.log('mockRepos type:', typeof mockRepos);
    const emailProcessor = new EmailProcessor(mockRepos, () => {});
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
