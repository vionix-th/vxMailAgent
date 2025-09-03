import { test } from 'node:test';
import assert from 'node:assert';

import { updateAccount } from './accounts';
import { ValidationError } from './error-handler';
import type { Account } from '../../shared/types';
import type { ReqLike } from '../utils/repo-access';

test('updateAccount rejects mismatched ids', async () => {
  const existing: Account = {
    id: 'a1',
    provider: 'gmail',
    email: 'a1@example.com',
    signature: '',
    tokens: { accessToken: '', refreshToken: '', expiry: '' },
  };

  let persisted = false;
  const repo = {
    getAll: async () => [existing],
    setAll: async () => { persisted = true; },
  };

  const req = { userContext: { uid: 'u1', repos: { accounts: repo } } } as unknown as ReqLike;
  const next: Account = { ...existing, id: 'a2' };

  await assert.rejects(
    async () => updateAccount(req, 'a1', next),
    (err: any) => err instanceof ValidationError && err.statusCode === 400,
  );

  assert.strictEqual(persisted, false);
});

