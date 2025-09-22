#!/usr/bin/env ts-node
import { SqliteConnectionFactory } from '../src/backend/storage/sqlite';
import { sharedDatabasePath, userDatabasePath } from '../src/backend/storage/sqlite';

const factory = new SqliteConnectionFactory();

async function initShared() {
  const handle = factory.getSharedHandle();
  await handle.withConnection(async () => undefined);
}

async function initUser(uid: string) {
  const handle = factory.getUserHandle(uid);
  await handle.withConnection(async () => undefined);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Initializing shared SQLite database at', sharedDatabasePath());
    await initShared();
  } else {
    for (const uid of args) {
      console.log('Initializing user SQLite database for', uid, 'at', userDatabasePath(uid).dbFile);
      await initUser(uid);
    }
  }
  await factory.closeAll();
  console.log('Done.');
}

void main().catch((error) => {
  console.error('Initialization failed:', error);
  process.exit(1);
});
