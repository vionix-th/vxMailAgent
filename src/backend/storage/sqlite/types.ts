import type DatabaseConstructor from 'better-sqlite3';

export type BetterSqliteDatabase = DatabaseConstructor.Database;

export type SqliteTask<T> = (db: BetterSqliteDatabase) => Promise<T> | T;

export interface StorageHandle {
  readonly id: string;
  readonly kind: 'shared' | 'user';
  withConnection<T>(task: SqliteTask<T>): Promise<T>;
  transaction<T>(task: SqliteTask<T>): Promise<T>;
  close(): Promise<void>;
  isClosed(): boolean;
}

export interface SqliteFactoryOptions {
  busyTimeoutMs?: number;
  synchronous?: 'OFF' | 'NORMAL' | 'FULL' | 'EXTRA';
}
