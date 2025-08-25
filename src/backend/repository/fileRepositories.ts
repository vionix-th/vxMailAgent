import fs from 'fs';
import * as persistence from '../persistence';
import { Repository } from './core';
import { 
  PROVIDER_EVENTS_FILE,
  TRACES_FILE,
} from '../utils/paths';
import { ProviderEvent, Trace } from '../../shared/types';
import { TRACE_MAX_TRACES, TRACE_TTL_DAYS, PROVIDER_MAX_EVENTS, PROVIDER_TTL_DAYS } from '../config';

/** Simple JSON file-based repository implementation. */
export class FileJsonRepository<T> implements Repository<T> {
  constructor(private filePath: string) {}

  /** Return all records from the backing file. */
  getAll(): T[] {
    try {
      if (fs.existsSync(this.filePath)) return persistence.loadAndDecrypt(this.filePath) as T[];
    } catch (e) {
      console.error(`[ERROR] FileJsonRepository.getAll failed for ${this.filePath}:`, e);
    }
    return [] as T[];
  }

  /** Overwrite the backing file with the provided records. */
  setAll(next: T[]): void {
    try {
      persistence.encryptAndPersist(next, this.filePath);
    } catch (e) {
      console.error(`[ERROR] FileJsonRepository.setAll failed for ${this.filePath}:`, e);
    }
  }
}

export interface ProviderEventsRepository extends Repository<ProviderEvent> {
  append(ev: ProviderEvent): void;
}

/** Repository for provider events persisted to a JSON file. */
export class FileProviderEventsRepository implements ProviderEventsRepository {
  constructor(private filePath: string = PROVIDER_EVENTS_FILE) {}

  /** Remove expired or excess events. */
  private prune(list: ProviderEvent[]): ProviderEvent[] {
    try {
      const ttlMs = Math.max(0, PROVIDER_TTL_DAYS) * 24 * 60 * 60 * 1000;
      const now = Date.now();
      let next = list;
      if (ttlMs > 0) {
        next = next.filter(e => {
          const ts = Date.parse(e.timestamp || '');
          return isNaN(ts) ? true : (now - ts) <= ttlMs;
        });
      }
      if (PROVIDER_MAX_EVENTS > 0 && next.length > PROVIDER_MAX_EVENTS) {
        next = next.slice(Math.max(0, next.length - PROVIDER_MAX_EVENTS));
      }
      return next;
    } catch {
      return list;
    }
  }

  /** Retrieve all provider events. */
  getAll(): ProviderEvent[] {
    try {
      if (fs.existsSync(this.filePath)) return this.prune(persistence.loadAndDecrypt(this.filePath) as ProviderEvent[]);
    } catch (e) { console.error('[ERROR] FileProviderEventsRepository.getAll failed:', e); }
    return [];
  }

  /** Replace all provider events on disk after pruning. */
  setAll(next: ProviderEvent[]): void {
    const pruned = this.prune(next);
    try { persistence.encryptAndPersist(pruned, this.filePath); } catch (e) { console.error('[ERROR] FileProviderEventsRepository.setAll failed:', e); }
  }

  /** Append a single provider event to the repository. */
  append(ev: ProviderEvent): void {
    const list = this.getAll();
    list.push(ev);
    this.setAll(list);
  }
}

export interface TracesRepository extends Repository<Trace> {
  append(t: Trace): void;
  update(id: string, updater: (t: Trace) => Trace | void): void;
}

/** Repository for trace diagnostics persisted to a JSON file. */
export class FileTracesRepository implements TracesRepository {
  constructor(private filePath: string = TRACES_FILE) {}

  /** Remove expired or excess traces. */
  private prune(list: Trace[]): Trace[] {
    try {
      const ttlMs = Math.max(0, TRACE_TTL_DAYS) * 24 * 60 * 60 * 1000;
      const now = Date.now();
      let next = list;
      if (ttlMs > 0) {
        next = next.filter(t => {
          const ts = Date.parse(t.createdAt || '');
          return isNaN(ts) ? true : (now - ts) <= ttlMs;
        });
      }
      if (TRACE_MAX_TRACES > 0 && next.length > TRACE_MAX_TRACES) {
        next = next.slice(Math.max(0, next.length - TRACE_MAX_TRACES));
      }
      return next;
    } catch {
      return list;
    }
  }

  /** Retrieve all trace entries. */
  getAll(): Trace[] {
    try {
      if (fs.existsSync(this.filePath)) return this.prune(persistence.loadAndDecrypt(this.filePath) as Trace[]);
    } catch (e) { console.error('[ERROR] FileTracesRepository.getAll failed:', e); }
    return [];
  }

  /** Replace all trace entries on disk after pruning. */
  setAll(next: Trace[]): void {
    const pruned = this.prune(next);
    try { persistence.encryptAndPersist(pruned, this.filePath); } catch (e) { console.error('[ERROR] FileTracesRepository.setAll failed:', e); }
  }

  /** Append a single trace entry. */
  append(t: Trace): void {
    const list = this.getAll();
    list.push(t);
    this.setAll(list);
  }

  /** Update an existing trace entry by id. */
  update(id: string, updater: (t: Trace) => Trace | void): void {
    const list = this.getAll();
    const idx = list.findIndex(x => x.id === id);
    if (idx >= 0) {
      const cur = list[idx];
      const result = updater(cur);
      if (result) list[idx] = result;
      this.setAll(list);
    }
  }
}

/** Create a JSON file-backed repository for the given path. */
export function createJsonRepository<T>(filePath: string): Repository<T> {
  return new FileJsonRepository<T>(filePath);
}
