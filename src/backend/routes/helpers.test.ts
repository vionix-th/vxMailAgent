import { test } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { once } from 'node:events';
import { AddressInfo } from 'node:net';
import { createCrudRoutes, CrudRepoFunctions } from './helpers';

interface Item { id: string; name: string; }

async function startServer(repo: CrudRepoFunctions<Item>) {
  const app = express();
  app.use(express.json());
  createCrudRoutes<Item>(app, '/api/items', repo, { itemName: 'item' });
  const server = app.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

test('PUT returns 400 when body id mismatches path', async () => {
  let items: Item[] = [{ id: '1', name: 'one' }];
  const repo: CrudRepoFunctions<Item> = {
    getAll: async () => items,
    setAll: async (_req: any, next: any) => { items = next; }
  };
  const { server, url } = await startServer(repo);
  try {
    const res = await fetch(`${url}/api/items/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '2', name: 'two' })
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(String(body.error).includes('ID'));
    assert.deepStrictEqual(items, [{ id: '1', name: 'one' }]);
  } finally {
    server.close();
  }
});

test('PUT assigns path id when body id missing', async () => {
  let items: Item[] = [{ id: '1', name: 'one' }];
  const repo: CrudRepoFunctions<Item> = {
    getAll: async () => items,
    setAll: async (_req: any, next: any) => { items = next; }
  };
  const { server, url } = await startServer(repo);
  try {
    const res = await fetch(`${url}/api/items/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'updated' })
    });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(items, [{ id: '1', name: 'updated' }]);
  } finally {
    server.close();
  }
});
