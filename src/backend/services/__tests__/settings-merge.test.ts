import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RepositoryError } from '../error-handler';
import { mergeApiConfigUpdates } from '../settings';
import type { ApiConfig } from '../../../shared/types';

const baseConfigs: ApiConfig[] = [
  {
    id: 'cfg-primary',
    name: 'Primary',
    model: 'gpt-4o',
    apiKey: 'sk-primary',
    provider: 'openai',
  },
  {
    id: 'cfg-secondary',
    name: 'Secondary',
    model: 'gpt-4o-mini',
    apiKey: 'sk-secondary',
    provider: 'openai',
  },
];

void test('mergeApiConfigUpdates updates targeted configs while preserving others', () => {
  const result = mergeApiConfigUpdates(baseConfigs, [
    { id: 'cfg-primary', name: 'Primary Updated', maxCompletionTokens: 2048 },
  ]);
  assert.strictEqual(result.length, 2, 'merged array should maintain original length');
  const primary = result.find((cfg) => cfg.id === 'cfg-primary');
  const secondary = result.find((cfg) => cfg.id === 'cfg-secondary');
  assert.ok(primary, 'primary config must exist');
  assert.ok(secondary, 'secondary config must exist');
  assert.strictEqual(primary?.name, 'Primary Updated', 'primary config should reflect updated name');
  assert.strictEqual(primary?.maxCompletionTokens, 2048, 'primary config should include updated tokens');
  assert.strictEqual(primary?.apiKey, 'sk-primary', 'api key must remain unchanged');
  assert.strictEqual(secondary?.name, 'Secondary', 'untouched config must retain original values');
  assert.strictEqual(secondary?.apiKey, 'sk-secondary', 'untouched config must retain api key');
  assert.strictEqual(baseConfigs[0].name, 'Primary', 'original array must not be mutated');
});

void test('mergeApiConfigUpdates rejects unknown ids', () => {
  assert.throws(
    () => mergeApiConfigUpdates(baseConfigs, [{ id: 'missing', name: 'Nope' }]),
    (error: unknown) => error instanceof RepositoryError && /not found/.test(error.message)
  );
});

void test('mergeApiConfigUpdates rejects duplicate ids', () => {
  assert.throws(
    () => mergeApiConfigUpdates(baseConfigs, [
      { id: 'cfg-primary', name: 'Dup-One' },
      { id: 'cfg-primary', name: 'Dup-Two' },
    ]),
    (error: unknown) => error instanceof RepositoryError && /duplicate/.test(error.message)
  );
});

void test('mergeApiConfigUpdates rejects apiKey updates', () => {
  assert.throws(
    () => mergeApiConfigUpdates(baseConfigs, [{ id: 'cfg-secondary', apiKey: 'sk-new' } as Partial<ApiConfig>]),
    (error: unknown) => error instanceof RepositoryError && /apiKey updates/.test(error.message)
  );
});
