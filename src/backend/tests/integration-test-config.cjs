const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Integration test configuration for real vs mock data
class TestConfig {
  constructor() {
    this.useRealData = process.env.VX_TEST_REAL_DATA === 'true';
    this.testUserId = process.env.VX_TEST_USER_ID || 'test-user';
    this.dataPath = process.env.VX_DATA_PATH || path.join(__dirname, '../../data');
  }

  async getRealUserData() {
    if (!this.useRealData) {
      return null;
    }

    const userDataPath = path.join(this.dataPath, 'users', this.testUserId);
    
    if (!fs.existsSync(userDataPath)) {
      console.warn(`Real user data not found at ${userDataPath}`);
      return null;
    }

    try {
      const conversations = this.loadJsonFile(path.join(userDataPath, 'conversations.json'));
      const settings = this.loadJsonFile(path.join(userDataPath, 'settings.json'));
      const directors = this.loadJsonFile(path.join(userDataPath, 'directors.json'));
      const agents = this.loadJsonFile(path.join(userDataPath, 'agents.json'));
      const prompts = this.loadJsonFile(path.join(userDataPath, 'prompts.json'));
      
      return {
        conversations: conversations || [],
        settings: settings || { apiConfigs: [] },
        directors: directors || [],
        agents: agents || [],
        prompts: prompts || []
      };
    } catch (error) {
      console.warn(`Failed to load real user data: ${error.message}`);
      return null;
    }
  }

  loadJsonFile(filePath) {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  getMockData() {
    return {
      conversations: [
        {
          id: 'conv-1',
          kind: 'director',
          directorId: 'dir-1',
          status: 'ongoing',
          messages: [
            { role: 'system', content: 'You are a director' },
            { role: 'user', content: 'Process this email' }
          ]
        }
      ],
      settings: {
        apiConfigs: [
          { id: 'config-1', name: 'Test OpenAI', provider: 'openai', apiKey: 'test-key' }
        ]
      },
      directors: [
        { id: 'dir-1', name: 'Test Director', promptId: 'prompt-1', apiConfigId: 'config-1' }
      ],
      agents: [
        { id: 'agent-1', name: 'Test Agent', promptId: 'prompt-2', apiConfigId: 'config-1' }
      ],
      prompts: [
        { id: 'prompt-1', name: 'Director Prompt', messages: [{ role: 'system', content: 'Director system prompt' }] },
        { id: 'prompt-2', name: 'Agent Prompt', messages: [{ role: 'system', content: 'Agent system prompt' }] }
      ]
    };
  }

  async getTestData() {
    if (this.useRealData) {
      const realData = await this.getRealUserData();
      if (realData) {
        console.log(`Using real data for user: ${this.testUserId}`);
        return realData;
      }
      console.log('Falling back to mock data');
    }
    
    console.log('Using mock data');
    return this.getMockData();
  }
}

test('TestConfig loads mock data correctly', async () => {
  const config = new TestConfig();
  const data = await config.getTestData();
  
  assert.ok(data);
  assert.ok(Array.isArray(data.conversations));
  assert.ok(Array.isArray(data.directors));
  assert.ok(Array.isArray(data.agents));
  assert.ok(Array.isArray(data.prompts));
  assert.ok(data.settings);
  assert.ok(Array.isArray(data.settings.apiConfigs));
});

test('TestConfig respects environment variables', () => {
  // Test with real data flag
  process.env.VX_TEST_REAL_DATA = 'true';
  process.env.VX_TEST_USER_ID = 'custom-user';
  
  const config = new TestConfig();
  
  assert.strictEqual(config.useRealData, true);
  assert.strictEqual(config.testUserId, 'custom-user');
  
  // Clean up
  delete process.env.VX_TEST_REAL_DATA;
  delete process.env.VX_TEST_USER_ID;
});

module.exports = { TestConfig };
