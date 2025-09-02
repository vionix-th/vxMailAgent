/**
 * Basic repository interface for entities persisted on disk.
 */
export interface Repository<T> {
  /** Retrieve all records from storage. */
  getAll(): Promise<T[]>;
  /** Replace the entire collection in storage. */
  setAll(next: T[]): Promise<void>;
}
