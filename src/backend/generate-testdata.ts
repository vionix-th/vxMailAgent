// Script to wipe and regenerate canonical test/example data for all entities
// Usage: npx ts-node src/backend/generate-testdata.ts
const fs = require('fs');
const path = require('path');
const envPath = path.resolve(__dirname, '.env');
require('dotenv').config({ path: envPath });
const { logger } = require('./services/logger');

// Use centralized DATA_DIR from backend utils/paths
const { DATA_DIR } = require('./utils/paths');

function main() {
  const files = [
    'accounts.json',
    'agents.json',
    'directors.json',
    'filters.json',
    'imprints.json',
    'orchestrationLog.json',
    'prompts.json',
    'settings.json',
    'memory.json',
  ];
  const FILE_PATHS: Record<string, string> = {
    'accounts.json': path.join(DATA_DIR, 'accounts.json'),
    'agents.json': path.join(DATA_DIR, 'agents.json'),
    'directors.json': path.join(DATA_DIR, 'directors.json'),
    'filters.json': path.join(DATA_DIR, 'filters.json'),
    'imprints.json': path.join(DATA_DIR, 'imprints.json'),
    'orchestrationLog.json': path.join(DATA_DIR, 'orchestrationLog.json'),
    'prompts.json': path.join(DATA_DIR, 'prompts.json'),
    'settings.json': path.join(DATA_DIR, 'settings.json'),
    'memory.json': path.join(DATA_DIR, 'memory.json'),
  };

  const now = new Date();
  function isoPlus(ms: number) { return new Date(now.getTime() + ms).toISOString(); }

  const canonicalData: Record<string, any> = {
    'accounts.json': [
      {
        id: 'test.user@gmail.com',
        provider: 'gmail',
        email: 'test.user@gmail.com',
        signature: '',
        tokens: {
          accessToken: 'test-access-token',
          refreshToken: 'test-refresh-token',
          expiry: '2099-01-01T00:00:00Z'
        },
        created: isoPlus(0),
        updated: isoPlus(0),
      },
      {
        id: 'outlook.user@example.com',
        provider: 'outlook',
        email: 'outlook.user@example.com',
        signature: '',
        tokens: {
          accessToken: 'outlook-access-token',
          refreshToken: 'outlook-refresh-token',
          expiry: '2099-01-01T00:00:00Z'
        },
        created: isoPlus(1000),
        updated: isoPlus(2000),
      },
    ],
    'agents.json': [
      {
        id: 'openai-test',
        name: 'Test OpenAI Agent',
        type: 'openai',
        promptId: 'prompt-1',
        apiConfigId: 'config-1',
        created: isoPlus(0),
        updated: isoPlus(0),
      },
      {
        id: 'openai-2',
        name: 'OpenAI Secondary',
        type: 'openai',
        promptId: 'prompt-2',
        apiConfigId: 'config-2',
        created: isoPlus(1000),
        updated: isoPlus(2000),
      },
    ],
    'directors.json': [
      {
        id: 'director-1',
        name: 'Test Director',
        agentIds: ['openai-test', 'openai-2'],
        promptId: 'prompt-1',
        apiConfigId: 'config-1',
        created: isoPlus(0),
        updated: isoPlus(0),
      },
      {
        id: 'director-2',
        name: 'Director Multi',
        agentIds: ['openai-2'],
        promptId: 'prompt-2',
        apiConfigId: 'config-2',
        created: isoPlus(1000),
        updated: isoPlus(2000),
      },
    ],
    'filters.json': [
      {
        id: 'filter-1',
        field: 'subject',
        regex: 'test',
        directorId: 'director-1',
        duplicateAllowed: false,
      },
      {
        id: 'filter-2',
        field: 'from',
        regex: 'outlook\\.user@example\\.com',
        directorId: 'director-2',
        duplicateAllowed: false,
      },
    ],
    'imprints.json': [
      {
        id: 'imprint-1',
        name: 'Test Imprint',
        content: 'Test signature',
        created: isoPlus(0),
        updated: isoPlus(0),
      },
      {
        id: 'imprint-2',
        name: 'Alternate Imprint',
        content: 'Alternate signature',
        created: isoPlus(1000),
        updated: isoPlus(2000),
      },
    ],
    'orchestrationLog.json': [
      // Cycle 1 (fetch cycle id is the cycle start ISO)
      // Director thread events
      {
        timestamp: isoPlus(0),
        fetchCycleId: isoPlus(0),
        dirThreadId: 'dir-thread-1',
        director: 'director-1',
        directorName: 'Test Director',
        agent: 'openai-test',
        agentName: 'Test OpenAI Agent',
        emailSummary: 'Test email summary',
        accountId: 'test.user@gmail.com',
        email: {
          id: 'gmail-msg-1',
          subject: 'Registration Successful!',
          from: '"Vivago.ai" <official@vivago.ai>',
          date: isoPlus(0),
          snippet: 'Welcome to Vivago.ai... ',
          bodyPlain: 'Hello, your registration was successful.\nRegards, Vivago',
          bodyHtml: '<p>Hello, your registration was <b>successful</b>.<br/>Regards, Vivago</p>',
          attachments: [ { id: 'att-1', filename: 'file.txt', mimeType: 'text/plain', url: 'https://example.com/file.txt' } ],
        },
        phase: 'director',
        detail: { event: 'director_start' }
      },
      {
        timestamp: isoPlus(100),
        fetchCycleId: isoPlus(0),
        dirThreadId: 'dir-thread-1',
        director: 'director-1',
        directorName: 'Test Director',
        agent: 'openai-test',
        agentName: 'Test OpenAI Agent',
        emailSummary: 'Test email summary',
        accountId: 'test.user@gmail.com',
        phase: 'director',
        detail: { tool: 'agent', sessionId: 'agent-thread-1', reason: 'delegate summarization' }
      },
      // Agent thread events
      {
        timestamp: isoPlus(200),
        fetchCycleId: isoPlus(0),
        dirThreadId: 'dir-thread-1',
        agentThreadId: 'agent-thread-1',
        director: 'director-1',
        agent: 'openai-test',
        agentName: 'Test OpenAI Agent',
        emailSummary: 'Test email summary',
        phase: 'agent',
        detail: { event: 'agent_start' }
      },
      {
        timestamp: isoPlus(300),
        fetchCycleId: isoPlus(0),
        dirThreadId: 'dir-thread-1',
        agentThreadId: 'agent-thread-1',
        director: 'director-1',
        agent: 'openai-test',
        agentName: 'Test OpenAI Agent',
        emailSummary: 'Test email summary',
        phase: 'tool',
        detail: { tool: 'memory', action: 'search', request: { scope: 'shared', query: 'registration' }, response: { success: true, results: 2 } }
      },
      {
        timestamp: isoPlus(400),
        fetchCycleId: isoPlus(0),
        dirThreadId: 'dir-thread-1',
        agentThreadId: 'agent-thread-1',
        director: 'director-1',
        agent: 'openai-test',
        agentName: 'Test OpenAI Agent',
        emailSummary: 'Test email summary',
        phase: 'agent',
        detail: { event: 'agent_output', note: 'Generated draft reply' }
      },
      // Director result event
      {
        timestamp: isoPlus(500),
        fetchCycleId: isoPlus(0),
        dirThreadId: 'dir-thread-1',
        director: 'director-1',
        directorName: 'Test Director',
        agent: 'openai-test',
        agentName: 'Test OpenAI Agent',
        emailSummary: 'Test email summary',
        accountId: 'test.user@gmail.com',
        phase: 'result',
        result: {
          content: 'Test content',
          toolCallResult: { kind: 'memory', success: true, result: { found: 2, entries: ['memory-1', 'memory-2'] } },
          notifications: [{ type: 'info', message: 'Memory search completed.' }],
          attachments: [{ id: 'att-1', filename: 'file.txt', mimeType: 'text/plain', url: 'https://example.com/file.txt' }],
          reply: { to: 'test.user@gmail.com', subject: 'RE: Test', body: 'Summary attached.', attachments: [{ id: 'att-1', filename: 'file.txt', mimeType: 'text/plain', url: 'https://example.com/file.txt' }] }
        }
      },

      // Cycle 2
      // Director thread events
      {
        timestamp: isoPlus(60000),
        fetchCycleId: isoPlus(60000),
        dirThreadId: 'dir-thread-2',
        director: 'director-2',
        directorName: 'Director Multi',
        agent: 'openai-2',
        agentName: 'OpenAI Secondary',
        emailSummary: 'Another email summary',
        accountId: 'outlook.user@example.com',
        email: {
          id: 'outlook-msg-1',
          subject: 'Meeting Request',
          from: 'boss@example.com',
          date: isoPlus(60000),
          snippet: 'Please confirm your availability...',
          bodyPlain: 'Can you meet tomorrow at 10?',
          bodyHtml: '<p>Can you meet <i>tomorrow</i> at 10?</p>',
          attachments: [],
        },
        phase: 'director',
        detail: { event: 'director_start' }
      },
      {
        timestamp: isoPlus(60100),
        fetchCycleId: isoPlus(60000),
        dirThreadId: 'dir-thread-2',
        director: 'director-2',
        directorName: 'Director Multi',
        agent: 'openai-2',
        agentName: 'OpenAI Secondary',
        emailSummary: 'Another email summary',
        accountId: 'outlook.user@example.com',
        phase: 'director',
        detail: { tool: 'agent', sessionId: 'agent-thread-2', reason: 'calendar check' }
      },
      // Agent thread events (with an error)
      {
        timestamp: isoPlus(60200),
        fetchCycleId: isoPlus(60000),
        dirThreadId: 'dir-thread-2',
        agentThreadId: 'agent-thread-2',
        director: 'director-2',
        agent: 'openai-2',
        agentName: 'OpenAI Secondary',
        emailSummary: 'Another email summary',
        phase: 'agent',
        detail: { event: 'agent_start' }
      },
      {
        timestamp: isoPlus(60300),
        fetchCycleId: isoPlus(60000),
        dirThreadId: 'dir-thread-2',
        agentThreadId: 'agent-thread-2',
        director: 'director-2',
        agent: 'openai-2',
        agentName: 'OpenAI Secondary',
        emailSummary: 'Another email summary',
        phase: 'tool',
        detail: { tool: 'calendar', action: 'read', provider: 'outlook', accountId: 'outlook.user@example.com', request: { dateRange: { start: '2099-01-01T10:00:00Z', end: '2099-01-01T11:00:00Z' } } },
        error: 'Calendar unavailable'
      }
    ],
    'prompts.json': [
      {
        id: 'prompt-1',
        name: 'Test Prompt',
        messages: [
          { role: 'system', content: 'You are a helpful agent.' },
          { role: 'user', content: 'Summarize this email.' }
        ],
        created: isoPlus(0),
        updated: isoPlus(0),
      },
      {
        id: 'prompt-2',
        name: 'Secondary Prompt',
        messages: [
          { role: 'system', content: 'You are a strict critic.' },
          { role: 'user', content: 'Critique this email.' }
        ],
        created: isoPlus(1000),
        updated: isoPlus(2000),
      },
    ],
    'settings.json': {
      virtualRoot: '/virtual',
      apiConfigs: [
        { id: 'config-1', name: 'Default OpenAI', apiKey: 'sk-test', model: 'gpt-4' },
        { id: 'config-2', name: 'Secondary OpenAI', apiKey: 'sk-test2', model: 'gpt-3.5-turbo' },
      ],
      signatures: { 'test-google': 'Test signature' },
    },
    'memory.json': [
      // Canonical agent owner
      {
        id: 'memory-agent',
        scope: 'local',
        content: 'Local memory for OpenAI agent.',
        created: isoPlus(1000),
        updated: isoPlus(1000),
        tags: ['agent', 'local'],
        relatedEmailId: 'email-agent',
        owner: 'openai-test',
        metadata: { session: 'abc123' },
      },
      // Canonical director owner
      {
        id: 'memory-director',
        scope: 'shared',
        content: 'Shared memory for director.',
        created: isoPlus(2000),
        updated: isoPlus(2000),
        tags: ['director', 'shared'],
        relatedEmailId: 'email-director',
        owner: 'director-1',
        metadata: { context: 'project' },
      },
      // Canonical user/account owner
      {
        id: 'memory-user',
        scope: 'global',
        content: 'Global memory entry for user account.',
        created: isoPlus(3000),
        updated: isoPlus(3000),
        tags: ['user', 'global'],
        relatedEmailId: 'email-user',
        owner: 'test-google',
        metadata: { importance: 'high' },
      },
      // Unknown owner
      {
        id: 'memory-unknown',
        scope: 'local',
        content: 'Memory entry with unknown owner for diagnostics.',
        created: isoPlus(4000),
        updated: isoPlus(4000),
        tags: ['unknown', 'diagnostics'],
        relatedEmailId: 'email-unknown',
        owner: 'does-not-exist',
        metadata: { provenance: 'unknown' },
      },
      // Legacy/system owner
      {
        id: 'memory-system',
        scope: 'global',
        content: 'Legacy/system memory entry.',
        created: isoPlus(5000),
        updated: isoPlus(5000),
        tags: ['system', 'legacy'],
        relatedEmailId: 'email-system',
        owner: 'system',
        metadata: { legacy: true },
      },
    ],
  };

  logger.info('[TESTDATA] Wiping data directory', { dataDir: DATA_DIR });
  for (const file of files) {
    const filePath = FILE_PATHS[file];
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info('[TESTDATA] Deleted file', { file });
    }
  }
  logger.info('[TESTDATA] Generating canonical test/example data...');
  for (const file of files) {
    const filePath = FILE_PATHS[file];
    fs.writeFileSync(filePath, JSON.stringify(canonicalData[file], null, 2), 'utf8');
    logger.info('[TESTDATA] Created file', { file });
  }
  logger.info('[TESTDATA] Done.');
}

main();

