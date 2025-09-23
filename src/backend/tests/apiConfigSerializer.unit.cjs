#!/usr/bin/env node

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { serializeApiConfig } from '../services/apiConfigSerializer';

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
