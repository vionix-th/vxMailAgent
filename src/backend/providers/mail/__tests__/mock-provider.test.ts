import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockMailProvider } from '../mock';
import { ValidationError } from '../../../services/error-handler';

const baseAccount = {
  id: 'account-1',
  provider: 'gmail',
  email: 'mock@example.com',
  signature: 'Mock Signature',
};

void test('mock provider enforces explicit tokens', async () => {
  const provider = createMockMailProvider('gmail');
  await assert.rejects(
    () => provider.ensureValidAccessToken({ ...baseAccount } as any),
    (error: unknown) => error instanceof ValidationError && error.code === 'MOCK_PROVIDER_MISSING_TOKENS'
  );
});

void test('mock provider rejects invalid expiry', async () => {
  const provider = createMockMailProvider('gmail');
  await assert.rejects(
    () => provider.ensureValidAccessToken({
      ...baseAccount,
      tokens: {
        accessToken: 'mock-access',
        refreshToken: 'mock-refresh',
        expiry: 'invalid-date',
      },
    } as any),
    (error: unknown) => error instanceof ValidationError && error.code === 'MOCK_PROVIDER_INVALID_EXPIRY'
  );
});

void test('mock provider returns persisted tokens when valid', async () => {
  const provider = createMockMailProvider('gmail');
  const expiry = new Date(Date.now() + 60_000).toISOString();
  const result = await provider.ensureValidAccessToken({
    ...baseAccount,
    tokens: {
      accessToken: 'mock-access',
      refreshToken: 'mock-refresh',
      expiry,
    },
  } as any);
  assert.deepStrictEqual(result, {
    updated: false,
    accessToken: 'mock-access',
    refreshToken: 'mock-refresh',
    expiry,
  });
});
