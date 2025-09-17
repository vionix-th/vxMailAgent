/**
 * Basic repository interface for entities persisted on disk.
 */
export interface Repository<T> {
  /** Retrieve all records from storage. */
  getAll(): Promise<T[]>;
  /** Replace the entire collection in storage. */
  setAll(next: T[]): Promise<void>;
  /**
   * Atomically mutate the repository contents under a lock.
   * The updater receives the latest list snapshot and must return the next list.
   * Implementations should guarantee read-modify-write happens within a single critical section.
   */
  mutate?(updater: (current: T[]) => Promise<T[]> | T[]): Promise<T[]>;
}
