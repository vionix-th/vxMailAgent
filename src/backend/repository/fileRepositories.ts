import fs from 'fs';
import * as persistence from '../persistence';
import { Repository } from './core';
import { dataPath } from '../utils/paths';
import { ProviderEvent, Trace } from '../../shared/types';
import { TRACE_MAX_TRACES, TRACE_TTL_DAYS, PROVIDER_MAX_EVENTS, PROVIDER_TTL_DAYS, USER_MAX_LOGS_PER_TYPE } from '../config';
import { securityAudit } from '../services/security-audit';
import { SecurityError } from '../services/error-handler';

/** Repository backed by an encrypted JSON file with security. */
export class FileJsonRepository<T> implements Repository<T> {
  constructor(
    private filePath: string, 
    private containerPath?: string,
    private maxItems?: number,
    private uid?: string
  ) {}

  private logFileOperation(operation: 'read' | 'write' | 'delete' | 'create', success: boolean, error?: string, fileSize?: number): void {
    securityAudit.logFileOperation(this.uid, {
      filePath: this.filePath,
      operation,
      success,
      error,
      fileSize
    });
  }
  
  getAll(): T[] {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = persistence.loadAndDecrypt(this.filePath, this.containerPath) as T[];
        const fileStats = fs.statSync(this.filePath);
        this.logFileOperation('read', true, undefined, fileStats.size);
        return data;
      }
      this.logFileOperation('read', true, 'File does not exist');
      return [] as T[];
    } catch (e) {
      const error = e as Error;
      this.logFileOperation('read', false, error.message);
      
      // Use error handler for consistent error processing
      if (error.message.includes('Security violation') || error.message.includes('Unsafe path')) {
        throw new SecurityError(`Path security violation: ${this.filePath}`);
      }
      
      console.error(`[ERROR] FileJsonRepository.getAll failed for ${this.filePath}:`, error);
      return [] as T[];
    }
  }
  
  setAll(next: T[]): void {
    let items = next;
    
    // Apply size limits if configured
    if (this.maxItems && items.length > this.maxItems) {
      items = items.slice(-this.maxItems); // Keep most recent
    }
    
    try {
      persistence.encryptAndPersist(items, this.filePath, this.containerPath);
      
      // Log successful write operation
      const fileStats = fs.existsSync(this.filePath) ? fs.statSync(this.filePath) : null;
      this.logFileOperation('write', true, undefined, fileStats?.size);
      
    } catch (e) {
      const error = e as Error;
      this.logFileOperation('write', false, error.message);
      
      // Use error handler for consistent error processing
      if (error.message.includes('Security violation') || error.message.includes('Unsafe path')) {
        throw new SecurityError(`Path security violation: ${this.filePath}`);
      }
      
      if (error.message.includes('size exceeds limit')) {
        throw new SecurityError(`File size limit exceeded: ${this.filePath}`);
      }
      
      console.error(`[ERROR] FileJsonRepository.setAll failed for ${this.filePath}:`, error);
      throw error;
    }
  }
}

/** Repository interface for provider events. */
export interface ProviderEventsRepository extends Repository<ProviderEvent> {
  append(ev: ProviderEvent): void;
}

/** Provider events repository persisted to disk with per-user support. */
export class FileProviderEventsRepository implements ProviderEventsRepository {
  constructor(
    private filePath: string = dataPath('provider-events.json'), 
    private containerPath?: string,
    private isPerUser: boolean = true,
    private uid?: string
  ) {}

  private logFileOperation(operation: 'read' | 'write' | 'delete' | 'create', success: boolean, error?: string, fileSize?: number): void {
    securityAudit.logFileOperation(this.uid, {
      filePath: this.filePath,
      operation,
      success,
      error,
      fileSize
    });
  }
  
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
      
      const maxEvents = this.isPerUser ? USER_MAX_LOGS_PER_TYPE : PROVIDER_MAX_EVENTS;
      if (maxEvents > 0 && next.length > maxEvents) {
        next = next.slice(Math.max(0, next.length - maxEvents));
      }
      
      return next;
    } catch {
      return list;
    }
  }
  
  getAll(): ProviderEvent[] {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = this.prune(persistence.loadAndDecrypt(this.filePath, this.containerPath) as ProviderEvent[]);
        const fileStats = fs.statSync(this.filePath);
        this.logFileOperation('read', true, undefined, fileStats.size);
        return data;
      }
      this.logFileOperation('read', true, 'File does not exist');
      return [];
    } catch (e) {
      const error = e as Error;
      this.logFileOperation('read', false, error.message);
      console.error('[ERROR] FileProviderEventsRepository.getAll failed:', error);
      return [];
    }
  }
  
  setAll(next: ProviderEvent[]): void {
    const pruned = this.prune(next);
    try { 
      persistence.encryptAndPersist(pruned, this.filePath, this.containerPath);
      const fileStats = fs.existsSync(this.filePath) ? fs.statSync(this.filePath) : null;
      this.logFileOperation('write', true, undefined, fileStats?.size);
    } catch (e) {
      const error = e as Error;
      this.logFileOperation('write', false, error.message);
      console.error('[ERROR] FileProviderEventsRepository.setAll failed:', error);
      throw error;
    }
  }
  
  append(ev: ProviderEvent): void {
    const list = this.getAll();
    list.push(ev);
    this.setAll(list);
  }
}

/** Repository interface for traces. */
export interface TracesRepository extends Repository<Trace> {
  append(t: Trace): void;
  update(id: string, updater: (t: Trace) => Trace | void): void;
}

/** Trace repository persisted to disk with per-user support. */
export class FileTracesRepository implements TracesRepository {
  constructor(
    private filePath: string = dataPath('traces.json'), 
    private containerPath?: string,
    private isPerUser: boolean = true,
    private uid?: string
  ) {}

  private logFileOperation(operation: 'read' | 'write' | 'delete' | 'create', success: boolean, error?: string, fileSize?: number): void {
    securityAudit.logFileOperation(this.uid, {
      filePath: this.filePath,
      operation,
      success,
      error,
      fileSize
    });
  }
  
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
      
      const maxTraces = this.isPerUser ? USER_MAX_LOGS_PER_TYPE : TRACE_MAX_TRACES;
      if (maxTraces > 0 && next.length > maxTraces) {
        next = next.slice(Math.max(0, next.length - maxTraces));
      }
      
      return next;
    } catch {
      return list;
    }
  }
  
  getAll(): Trace[] {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = this.prune(persistence.loadAndDecrypt(this.filePath, this.containerPath) as Trace[]);
        const fileStats = fs.statSync(this.filePath);
        this.logFileOperation('read', true, undefined, fileStats.size);
        return data;
      }
      this.logFileOperation('read', true, 'File does not exist');
      return [];
    } catch (e) {
      const error = e as Error;
      this.logFileOperation('read', false, error.message);
      console.error('[ERROR] FileTracesRepository.getAll failed:', error);
      return [];
    }
  }
  
  setAll(next: Trace[]): void {
    const pruned = this.prune(next);
    try { 
      persistence.encryptAndPersist(pruned, this.filePath, this.containerPath);
      const fileStats = fs.existsSync(this.filePath) ? fs.statSync(this.filePath) : null;
      this.logFileOperation('write', true, undefined, fileStats?.size);
    } catch (e) {
      const error = e as Error;
      this.logFileOperation('write', false, error.message);
      console.error('[ERROR] FileTracesRepository.setAll failed:', error);
      throw error;
    }
  }
  
  append(t: Trace): void {
    const list = this.getAll();
    list.push(t);
    this.setAll(list);
  }
  
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

/** Create a simple JSON file repository instance. */
export function createJsonRepository<T>(filePath: string, containerPath?: string, maxItems?: number): Repository<T> {
  return new FileJsonRepository<T>(filePath, containerPath, maxItems);
}

/** Create a per-user JSON repository with security and size limits. */
export function createUserJsonRepository<T>(filePath: string, containerPath: string, maxItems?: number, uid?: string): Repository<T> {
  return new FileJsonRepository<T>(filePath, containerPath, maxItems, uid);
}

/** Create a per-user provider events repository. */
export function createUserProviderEventsRepository(filePath: string, containerPath: string, uid?: string): ProviderEventsRepository {
  return new FileProviderEventsRepository(filePath, containerPath, true, uid);
}

/** Create a global provider events repository (legacy). */
export function createGlobalProviderEventsRepository(filePath: string, containerPath?: string): ProviderEventsRepository {
  return new FileProviderEventsRepository(filePath, containerPath, false);
}

/** Create a per-user traces repository. */
export function createUserTracesRepository(filePath: string, containerPath: string, uid?: string): TracesRepository {
  return new FileTracesRepository(filePath, containerPath, true, uid);
}

/** Create a global traces repository (legacy). */
export function createGlobalTracesRepository(filePath: string, containerPath?: string): TracesRepository {
  return new FileTracesRepository(filePath, containerPath, false);
}
