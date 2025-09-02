import { test } from 'node:test';
import assert from 'node:assert';
import { logOrch, logProviderEvent, flushLogQueue } from './logging';
import { logger } from './logger';
import { ReqLike } from '../utils/repo-access';
import { OrchestrationLogRepository, ProviderEventsRepository } from '../repository/fileRepositories';

// Helper to create req with minimal repos
function makeReq(repos: any): ReqLike {
  return { userContext: { uid: 'u1', repos } } as any;
}

test('logOrch logs errors when persistence fails', async () => {
  const errors: any[] = [];
  const original = logger.error;
  logger.error = (msg: string, meta?: any) => { errors.push({ msg, meta }); };

  const repo: OrchestrationLogRepository = {
    getAll: async () => [],
    setAll: async () => { throw new Error('persist fail'); },
    append: async () => {}
  } as any;

  logOrch({} as any, makeReq({ orchestrationLog: repo }));
  await flushLogQueue();

  assert.strictEqual(errors.length, 1);
  assert.ok(errors[0].msg.includes('logOrch'));
  assert.ok(String(errors[0].meta?.error).includes('persist fail'));

  logger.error = original;
});

test('logProviderEvent logs errors when append fails', async () => {
  const errors: any[] = [];
  const original = logger.error;
  logger.error = (msg: string, meta?: any) => { errors.push({ msg, meta }); };

  const repo: ProviderEventsRepository = {
    append: async () => { throw new Error('append fail'); },
    getAll: async () => [],
    setAll: async () => {}
  } as any;

  logProviderEvent({} as any, makeReq({ providerEvents: repo }));
  await flushLogQueue();

  assert.strictEqual(errors.length, 1);
  assert.ok(errors[0].msg.includes('logProviderEvent'));
  assert.ok(String(errors[0].meta?.error).includes('append fail'));

  logger.error = original;
});
