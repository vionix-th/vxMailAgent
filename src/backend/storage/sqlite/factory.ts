import fs from 'fs';
import path from 'path';
import DatabaseConstructor from 'better-sqlite3';
import logger from '../../services/logger';
import { sharedDatabasePath, userDatabasePath } from './paths';
import type { SqliteFactoryOptions, StorageHandle, SqliteTask } from './types';
import type { BetterSqliteDatabase } from './types';
import { ensureSchema } from './initializer';

class SqliteHandle implements StorageHandle {
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    private readonly db: BetterSqliteDatabase,
    public readonly id: string,
    public readonly kind: 'shared' | 'user'
  ) {}

  isClosed(): boolean {
    return this.closed;
  }

  async withConnection<T>(task: SqliteTask<T>): Promise<T> {
    if (this.closed) {
      throw new Error(`SQLite handle ${this.id} is closed`);
    }
    return this.enqueue(async () => task(this.db));
  }

  async transaction<T>(task: SqliteTask<T>): Promise<T> {
    if (this.closed) {
      throw new Error(`SQLite handle ${this.id} is closed`);
    }
    return this.enqueue(async () => {
      this.db.prepare('BEGIN IMMEDIATE').run();
      try {
        const result = await task(this.db);
        this.db.prepare('COMMIT').run();
        return result;
      } catch (error) {
        try {
          this.db.prepare('ROLLBACK').run();
        } catch (rollbackError) {
          logger.warn('SQLite rollback failed', {
            id: this.id,
            kind: this.kind,
            error: (rollbackError as Error)?.message || String(rollbackError),
          });
        }
        throw error;
      }
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.queue;
    this.db.close();
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.then(
      () => undefined,
      (error) => {
        logger.error('SQLite task failed', { id: this.id, kind: this.kind, error: (error as Error)?.message || String(error) });
        return undefined;
      }
    );
    return run;
  }
}

function applyPragmas(db: BetterSqliteDatabase, options: Required<SqliteFactoryOptions>) {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma(`busy_timeout = ${options.busyTimeoutMs}`);
  db.pragma(`synchronous = ${options.synchronous}`);
}

function ensureFile(pathname: string) {
  const dir = path.dirname(pathname);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  if (!fs.existsSync(pathname)) {
    const fd = fs.openSync(pathname, 'w', 0o600);
    fs.closeSync(fd);
  }
}

export class SqliteConnectionFactory {
  private readonly options: Required<SqliteFactoryOptions>;
  private sharedHandle: SqliteHandle | null = null;
  private readonly userHandles = new Map<string, SqliteHandle>();

  constructor(options?: SqliteFactoryOptions) {
    this.options = {
      busyTimeoutMs: options?.busyTimeoutMs ?? 5000,
      synchronous: options?.synchronous ?? 'NORMAL',
    };
  }

  getSharedHandle(): StorageHandle {
    if (!this.sharedHandle || this.sharedHandle.isClosed()) {
      const dbPath = sharedDatabasePath();
      ensureFile(dbPath);
      const db = new DatabaseConstructor(dbPath);
      applyPragmas(db, this.options);
      ensureSchema(db, 'shared');
      this.sharedHandle = new SqliteHandle(db, dbPath, 'shared');
    }
    return this.sharedHandle;
  }

  getUserHandle(uid: string): StorageHandle {
    const existing = this.userHandles.get(uid);
    if (existing && !existing.isClosed()) {
      return existing;
    }
    const { dbFile } = userDatabasePath(uid);
    ensureFile(dbFile);
    const db = new DatabaseConstructor(dbFile);
    applyPragmas(db, this.options);
    ensureSchema(db, 'user');
    const handle = new SqliteHandle(db, dbFile, 'user');
    this.userHandles.set(uid, handle);
    return handle;
  }

  async closeAll(): Promise<void> {
    const closures: Array<Promise<void>> = [];
    if (this.sharedHandle) {
      closures.push(this.sharedHandle.close());
      this.sharedHandle = null;
    }
    for (const [uid, handle] of this.userHandles.entries()) {
      closures.push(handle.close());
      this.userHandles.delete(uid);
    }
    await Promise.allSettled(closures);
  }

  async releaseUserHandle(uid: string): Promise<void> {
    const handle = this.userHandles.get(uid);
    if (!handle) return;
    await handle.close();
    this.userHandles.delete(uid);
  }
}
