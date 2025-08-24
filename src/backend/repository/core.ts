// Generic repository interfaces
export interface Repository<T> {
  // Always read fresh from disk
  getAll(): T[];
  // Persist entire collection
  setAll(next: T[]): void;
}
