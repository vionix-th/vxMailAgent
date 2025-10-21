import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStringTags } from '../../utils/tag-normalization';
import { ValidationError } from '../error-handler';

void test('normalizeStringTags trims and deduplicates tags', () => {
  const result = normalizeStringTags([' Alpha ', 'Beta', 'Alpha'], 'metadata.tags', {
    optional: false,
    skipEmpty: false,
    allowEmptyResult: true,
  });
  assert.deepStrictEqual(result, ['Alpha', 'Beta']);
});

void test('normalizeStringTags rejects empty entries when skipEmpty is false', () => {
  assert.throws(
    () => normalizeStringTags(['valid', '   '], 'metadata.tags', { optional: false, skipEmpty: false }),
    (error: unknown) => error instanceof ValidationError && error.code === 'TAGS_EMPTY_VALUE'
  );
});

void test('normalizeStringTags can skip empty strings when requested', () => {
  const result = normalizeStringTags([' foo ', ' ', '\tbar'], 'memory tags', {
    optional: false,
    skipEmpty: true,
    allowEmptyResult: true,
    fieldLabel: 'memory tags',
  });
  assert.deepStrictEqual(result, ['foo', 'bar']);
});

void test('normalizeStringTags respects optional flag', () => {
  const result = normalizeStringTags(undefined, 'metadata.tags', { optional: true });
  assert.strictEqual(result, undefined);
});
