/**
 * Basic repository interface for entities persisted on disk.
 */
export interface Repository<T> {
  /** Retrieve all records from storage. */
  getAll(): T[];
  /** Replace the entire collection in storage. */
  setAll(next: T[]): void;
}
