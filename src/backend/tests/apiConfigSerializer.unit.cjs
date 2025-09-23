#!/usr/bin/env node

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const path = require('path');
const fs = require('fs');

function loadSerializer() {
  const backendRoot = path.resolve(__dirname, '..');
  const distRoot = path.join(backendRoot, 'dist');
  const candidates = [
    path.join(distRoot, 'backend', 'services', 'apiConfigSerializer.js'),
    path.join(distRoot, 'services', 'apiConfigSerializer.js'),
  ];
  const target = candidates.find(fs.existsSync);
  if (!target) throw new Error('apiConfigSerializer.js not found in dist. Run `npm run build` in backend.');
  return require(target);
}

const { serializeApiConfig } = loadSerializer();

describe('serializeApiConfig', () => {
  it('strips apiKey and preserves public fields', () => {
    const view = serializeApiConfig({
      id: 'cfg-1',
      name: 'Primary',
      model: 'gpt-4o-mini',
      apiKey: 'secret-key',
      provider: 'openai',
      maxCompletionTokens: 1024,
    });
    assert.deepEqual(view, {
      id: 'cfg-1',
      name: 'Primary',
      model: 'gpt-4o-mini',
      maxCompletionTokens: 1024,
    });
    assert.ok(!('apiKey' in view));
  });
});
