import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFetcherLogEntry, validateFetcherLogEntries } from '../fetcher-log-validation';
import { ValidationError } from '../error-handler';

const baseEntry = {
  id: 'log-1',
  timestamp: new Date().toISOString(),
  level: 'info' as const,
  provider: null,
  accountId: 'all',
  event: 'integration_test',
  message: 'baseline entry',
  emailId: null,
};

void test('validateFetcherLogEntry accepts well-formed entry', () => {
  const result = validateFetcherLogEntry(baseEntry);
  assert.strictEqual(result, baseEntry);
});

void test('validateFetcherLogEntry rejects missing id', () => {
  assert.throws(
    () => validateFetcherLogEntry({ ...baseEntry, id: '' }),
    (error: unknown) => error instanceof ValidationError && error.code === 'FETCHER_LOG_INVALID_ID'
  );
});

void test('validateFetcherLogEntry rejects invalid timestamp', () => {
  assert.throws(
    () => validateFetcherLogEntry({ ...baseEntry, timestamp: 'not-a-date' }),
    (error: unknown) => error instanceof ValidationError && error.code === 'FETCHER_LOG_INVALID_TIMESTAMP'
  );
});

void test('validateFetcherLogEntries rejects non-array payload', () => {
  assert.throws(
    () => validateFetcherLogEntries({} as unknown, 'fetcherLog'),
    (error: unknown) => error instanceof ValidationError && error.code === 'FETCHER_LOG_INVALID_ARRAY'
  );
});

void test('validateFetcherLogEntries rejects missing emailId', () => {
  assert.throws(
    () => validateFetcherLogEntries([
      { ...baseEntry, emailId: undefined } as unknown,
    ]),
    (error: unknown) => error instanceof ValidationError && error.code === 'FETCHER_LOG_INVALID_FIELD'
  );
});
