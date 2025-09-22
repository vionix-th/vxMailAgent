import type { StorageHandle, SqliteTask } from '../types';

export abstract class SqliteRepository {
  protected constructor(private readonly handle: StorageHandle) {}

  protected withConnection<T>(task: SqliteTask<T>): Promise<T> {
    return this.handle.withConnection(task);
  }

  protected transaction<T>(task: SqliteTask<T>): Promise<T> {
    return this.handle.transaction(task);
  }
}

export function stringify(value: unknown): string {
  return JSON.stringify(value);
}

export function parseJson<T>(payload: string | null | undefined): T {
  if (!payload) return undefined as unknown as T;
  return JSON.parse(payload) as T;
}
