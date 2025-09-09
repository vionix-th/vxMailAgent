import fs from 'fs';
import { logger } from '../services/logger';
import * as persistence from '../persistence';
import { Repository } from './core';
import { ProviderEvent, Trace, FetcherLogEntry, OrchestrationDiagnosticEntry } from '../../shared/types';
import { TRACE_TTL_DAYS, PROVIDER_TTL_DAYS, USER_MAX_LOGS_PER_TYPE, FETCHER_TTL_DAYS, ORCHESTRATION_TTL_DAYS } from '../config';
import { securityAudit } from '../services/security-audit';
import { SecurityError, RepositoryError } from '../services/error-handler';
import { withFileLock } from '../utils/file-lock';

/** System-level file repository base with clear system-scoped auditing. */
export abstract class SystemFileRepoBase {
  constructor(protected filePath: string, protected containerPath: string) {}

  protected logFileOperation(
    operation: 'read' | 'write' | 'delete' | 'create',
    success: boolean,
    error?: string,
    fileSize?: number
  ): void {
    const details: any = { filePath: this.filePath, operation, success };
    if (error) details.error = error;
    if (fileSize !== undefined) details.fileSize = fileSize;
    securityAudit.logSystemFileOperation(details);
  }

  protected currentFileSize(): number {
    try {
      if (fs.existsSync(this.filePath)) {
        return fs.statSync(this.filePath).size;
      }
      return 0;
    } catch (e: any) {
      logger.warn('SystemFileRepoBase.currentFileSize failed', { 
        filePath: this.filePath, 
        error: e?.message || String(e) 
      });
      return 0;
    }
  }
}

/** User-scoped file repository base with mandatory user context. */
export abstract class UserFileRepoBase {
  constructor(
    protected filePath: string, 
    protected uid: string, 
    protected containerPath: string
  ) {
    if (!uid) throw new SecurityError('User context required for repository I/O');
  }

  protected logFileOperation(
    operation: 'read' | 'write' | 'delete' | 'create',
    success: boolean,
    error?: string,
    fileSize?: number
  ): void {
    const details: any = { filePath: this.filePath, operation, success };
    if (error) details.error = error;
    if (fileSize !== undefined) details.fileSize = fileSize;
    securityAudit.logUserFileOperation(this.uid, details);
  }

  protected currentFileSize(): number {
    try {
      if (fs.existsSync(this.filePath)) {
        return fs.statSync(this.filePath).size;
      }
      return 0;
    } catch (e: any) {
      logger.warn('UserFileRepoBase.currentFileSize failed', { 
        filePath: this.filePath, 
        uid: this.uid,
        error: e?.message || String(e) 
      });
      return 0;
    }
  }
}

/**
 * Generic pruning base that encapsulates TTL and max-items logic.
 * - Keeps logging and security via FileRepoBase.
 * - Timestamp extraction is configurable per repository.
 */
export abstract class PrunableFileRepo<T> extends UserFileRepoBase {
  constructor(
    filePath: string,
    uid: string,
    containerPath: string,
    private pruneOptions?: {
      ttlMs?: number | (() => number);
      maxItems?: number | (() => number);
      getTimestamp?: (item: T) => string | number | Date | undefined;
    }
  ) {
    super(filePath, uid, containerPath);
  }

  protected pruneList(list: T[]): T[] {
    try {
      let next = list;

      // TTL pruning
      const ttlVal = this.pruneOptions?.ttlMs;
      const ttlMs = typeof ttlVal === 'function' ? ttlVal() : ttlVal;
      if (ttlMs && ttlMs > 0) {
        const now = Date.now();
        const getTs = this.pruneOptions?.getTimestamp;
        if (getTs) {
          next = next.filter((item) => {
            const raw = getTs(item);
            let ts: number | undefined;
            if (raw instanceof Date) ts = raw.getTime();
            else if (typeof raw === 'number') ts = raw;
            else if (typeof raw === 'string') {
              const parsed = Date.parse(raw);
              ts = isNaN(parsed) ? undefined : parsed;
            }
            return ts === undefined ? true : (now - ts) <= ttlMs;
          });
        }
      }

      // Max items capping (keep most recent by list order)
      const maxVal = this.pruneOptions?.maxItems;
      const maxItems = typeof maxVal === 'function' ? maxVal() : maxVal;
      if (maxItems && maxItems > 0 && next.length > maxItems) {
        next = next.slice(Math.max(0, next.length - maxItems));
      }

      return next;
    } catch {
      return list;
    }
  }
}

/** Repository backed by an encrypted JSON file with security. */
export class FileJsonRepository<T> extends PrunableFileRepo<T> implements Repository<T> {
  constructor(
    filePath: string,
    uid: string,
    containerPath: string,
    maxItems?: number
  ) {
    super(filePath, uid, containerPath, (typeof maxItems === 'number' ? { maxItems } : undefined));
  }
  
  async getAll(): Promise<T[]> {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = await persistence.loadAndDecrypt(this.filePath, this.containerPath) as T[];
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

      logger.error('FileJsonRepository.getAll failed', { filePath: this.filePath, error });
      throw new RepositoryError(`Failed to read repository file: ${this.filePath}`);
    }
  }
  
  /** Internal write that assumes caller coordinates locking. */
  private async writeAllUnlocked(next: T[]): Promise<void> {
    const items = this.pruneList(next);
    try {
      await persistence.encryptAndPersist(items, this.filePath, this.containerPath);
      const fileStats = fs.existsSync(this.filePath) ? fs.statSync(this.filePath) : null;
      this.logFileOperation('write', true, undefined, fileStats?.size);
    } catch (e) {
      const error = e as Error;
      this.logFileOperation('write', false, error.message);
      if (error.message.includes('Security violation') || error.message.includes('Unsafe path')) {
        throw new SecurityError(`Path security violation: ${this.filePath}`);
      }
      if (error.message.includes('size exceeds limit')) {
        throw new SecurityError(`File size limit exceeded: ${this.filePath}`);
      }
      logger.error('FileJsonRepository.setAll failed', { filePath: this.filePath, error });
      throw error;
    }
  }

  async setAll(next: T[]): Promise<void> {
    await withFileLock(this.filePath, async () => {
      await this.writeAllUnlocked(next);
    });
  }
}

/** Repository interface for fetcher logs. */
export interface FetcherLogRepository extends Repository<FetcherLogEntry> {
  append(e: FetcherLogEntry): Promise<void>;
}

/** Fetcher log repository with TTL + cap pruning. */
export class FileFetcherLogRepository extends PrunableFileRepo<FetcherLogEntry> implements FetcherLogRepository {
  constructor(
    filePath: string,
    uid: string,
    containerPath: string
  ) {
    super(filePath, uid, containerPath, {
      ttlMs: () => Math.max(0, FETCHER_TTL_DAYS) * 24 * 60 * 60 * 1000,
      maxItems: () => USER_MAX_LOGS_PER_TYPE,
      getTimestamp: (e) => e.timestamp,
    });
  }

  async getAll(): Promise<FetcherLogEntry[]> {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = this.pruneList(await persistence.loadAndDecrypt(this.filePath, this.containerPath) as FetcherLogEntry[]);
        const fileStats = fs.statSync(this.filePath);
        this.logFileOperation('read', true, undefined, fileStats.size);
        return data;
      }
      this.logFileOperation('read', true, 'File does not exist');
      return [];
    } catch (e) {
      const error = e as Error;
      this.logFileOperation('read', false, error.message);
      logger.error('FileFetcherLogRepository.getAll failed', { error });
      throw new RepositoryError(`Failed to read fetcher log file: ${this.filePath}`);
    }
  }

  /** Internal write that assumes caller coordinates locking. */
  private async writeAllUnlocked(next: FetcherLogEntry[]): Promise<void> {
    const pruned = this.pruneList(next);
    try {
      await persistence.encryptAndPersist(pruned, this.filePath, this.containerPath);
      const fileStats = fs.existsSync(this.filePath) ? fs.statSync(this.filePath) : null;
      this.logFileOperation('write', true, undefined, fileStats?.size);
    } catch (e) {
      const error = e as Error;
      this.logFileOperation('write', false, error.message);
      logger.error('FileFetcherLogRepository.setAll failed', { error });
      throw error;
    }
  }

  async setAll(next: FetcherLogEntry[]): Promise<void> {
    await withFileLock(this.filePath, async () => {
      await this.writeAllUnlocked(next);
    });
  }

  async append(e: FetcherLogEntry): Promise<void> {
    await withFileLock(this.filePath, async () => {
      const list = await this.getAll();
      list.push(e);
      await this.writeAllUnlocked(list);
    });
  }
}

/** Repository interface for orchestration diagnostics log. */
export interface OrchestrationLogRepository extends Repository<OrchestrationDiagnosticEntry> {
  append(e: OrchestrationDiagnosticEntry): Promise<void>;
}

/** Orchestration diagnostics repository with TTL + cap pruning. */
export class FileOrchestrationLogRepository extends PrunableFileRepo<OrchestrationDiagnosticEntry> implements OrchestrationLogRepository {
  constructor(
    filePath: string,
    uid: string,
    containerPath: string
  ) {
    super(filePath, uid, containerPath, {
      ttlMs: () => Math.max(0, ORCHESTRATION_TTL_DAYS) * 24 * 60 * 60 * 1000,
      maxItems: () => USER_MAX_LOGS_PER_TYPE,
      getTimestamp: (e) => e.timestamp,
    });
  }

  async getAll(): Promise<OrchestrationDiagnosticEntry[]> {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = this.pruneList(await persistence.loadAndDecrypt(this.filePath, this.containerPath) as OrchestrationDiagnosticEntry[]);
        const fileStats = fs.statSync(this.filePath);
        this.logFileOperation('read', true, undefined, fileStats.size);
        return data;
      }
      this.logFileOperation('read', true, 'File does not exist');
      return [];
    } catch (e) {
      const error = e as Error;
      this.logFileOperation('read', false, error.message);
      logger.error('FileOrchestrationLogRepository.getAll failed', { error });
      throw new RepositoryError(`Failed to read orchestration log file: ${this.filePath}`);
    }
  }

  /** Internal write that assumes caller coordinates locking. */
  private async writeAllUnlocked(next: OrchestrationDiagnosticEntry[]): Promise<void> {
    const pruned = this.pruneList(next);
    try {
      await persistence.encryptAndPersist(pruned, this.filePath, this.containerPath);
      const fileStats = fs.existsSync(this.filePath) ? fs.statSync(this.filePath) : null;
      this.logFileOperation('write', true, undefined, fileStats?.size);
    } catch (e) {
      const error = e as Error;
      this.logFileOperation('write', false, error.message);
      logger.error('FileOrchestrationLogRepository.setAll failed', { error });
      throw error;
    }
  }

  async setAll(next: OrchestrationDiagnosticEntry[]): Promise<void> {
    await withFileLock(this.filePath, async () => {
      await this.writeAllUnlocked(next);
    });
  }

  async append(e: OrchestrationDiagnosticEntry): Promise<void> {
    await withFileLock(this.filePath, async () => {
      const list = await this.getAll();
      list.push(e);
      await this.writeAllUnlocked(list);
    });
  }
}

/** Repository interface for provider events. */
export interface ProviderEventsRepository extends Repository<ProviderEvent> {
  append(ev: ProviderEvent): Promise<void>;
}

/** Provider events repository persisted to disk with per-user support. */
export class FileProviderEventsRepository extends PrunableFileRepo<ProviderEvent> implements ProviderEventsRepository {
  constructor(
    filePath: string,
    uid: string,
    containerPath: string
  ) {
    super(filePath, uid, containerPath, {
      ttlMs: () => Math.max(0, PROVIDER_TTL_DAYS) * 24 * 60 * 60 * 1000,
      maxItems: () => USER_MAX_LOGS_PER_TYPE,
      getTimestamp: (e) => e.timestamp,
    });
  }
  
  async getAll(): Promise<ProviderEvent[]> {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = this.pruneList(await persistence.loadAndDecrypt(this.filePath, this.containerPath) as ProviderEvent[]);
        const fileStats = fs.statSync(this.filePath);
        this.logFileOperation('read', true, undefined, fileStats.size);
        return data;
      }
      this.logFileOperation('read', true, 'File does not exist');
      return [];
    } catch (e) {
      const error = e as Error;
      this.logFileOperation('read', false, error.message);
      logger.error('FileProviderEventsRepository.getAll failed', { error });
      throw new RepositoryError(`Failed to read provider events file: ${this.filePath}`);
    }
  }

  /** Internal write that assumes caller coordinates locking. */
  private async writeAllUnlocked(next: ProviderEvent[]): Promise<void> {
    const pruned = this.pruneList(next);
    try {
      await persistence.encryptAndPersist(pruned, this.filePath, this.containerPath);
      const fileStats = fs.existsSync(this.filePath) ? fs.statSync(this.filePath) : null;
      this.logFileOperation('write', true, undefined, fileStats?.size);
    } catch (e) {
      const error = e as Error;
      this.logFileOperation('write', false, error.message);
      logger.error('FileProviderEventsRepository.setAll failed', { error });
      throw error;
    }
  }

  async setAll(next: ProviderEvent[]): Promise<void> {
    await withFileLock(this.filePath, async () => {
      await this.writeAllUnlocked(next);
    });
  }

  async append(ev: ProviderEvent): Promise<void> {
    await withFileLock(this.filePath, async () => {
      const list = await this.getAll();
      list.push(ev);
      await this.writeAllUnlocked(list);
    });
  }
}

/** Repository interface for traces. */
export interface TracesRepository extends Repository<Trace> {
  append(t: Trace): Promise<void>;
  update(id: string, updater: (t: Trace) => Trace | void): Promise<void>;
}

/** Trace repository persisted to disk with per-user support. */
export class FileTracesRepository extends PrunableFileRepo<Trace> implements TracesRepository {
  constructor(
    filePath: string,
    uid: string,
    containerPath: string
  ) {
    super(filePath, uid, containerPath, {
      ttlMs: () => Math.max(0, TRACE_TTL_DAYS) * 24 * 60 * 60 * 1000,
      maxItems: () => USER_MAX_LOGS_PER_TYPE,
      getTimestamp: (t) => t.createdAt,
    });
  }
  
  async getAll(): Promise<Trace[]> {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = this.pruneList(await persistence.loadAndDecrypt(this.filePath, this.containerPath) as Trace[]);
        const fileStats = fs.statSync(this.filePath);
        this.logFileOperation('read', true, undefined, fileStats.size);
        return data;
      }
      this.logFileOperation('read', true, 'File does not exist');
      return [];
    } catch (e) {
      const error = e as Error;
      this.logFileOperation('read', false, error.message);
      logger.error('FileTracesRepository.getAll failed', { error });
      throw new RepositoryError(`Failed to read traces file: ${this.filePath}`);
    }
  }

  /** Internal write that assumes caller coordinates locking. */
  private async writeAllUnlocked(next: Trace[]): Promise<void> {
    const pruned = this.pruneList(next);
    try {
      await persistence.encryptAndPersist(pruned, this.filePath, this.containerPath);
      const fileStats = fs.existsSync(this.filePath) ? fs.statSync(this.filePath) : null;
      this.logFileOperation('write', true, undefined, fileStats?.size);
    } catch (e) {
      const error = e as Error;
      this.logFileOperation('write', false, error.message);
      logger.error('FileTracesRepository.setAll failed', { error });
      throw error;
    }
  }

  async setAll(next: Trace[]): Promise<void> {
    await withFileLock(this.filePath, async () => {
      await this.writeAllUnlocked(next);
    });
  }

  async append(t: Trace): Promise<void> {
    await withFileLock(this.filePath, async () => {
      const list = await this.getAll();
      list.push(t);
      await this.writeAllUnlocked(list);
    });
  }

  async update(id: string, updater: (t: Trace) => Trace | void): Promise<void> {
    await withFileLock(this.filePath, async () => {
      const list = await this.getAll();
      const idx = list.findIndex(x => x.id === id);
      if (idx >= 0) {
        const cur = list[idx];
        const result = updater(cur);
        if (result) list[idx] = result;
        await this.writeAllUnlocked(list);
      }
    });
  }
}

/** Create a simple JSON file repository instance. */
/** Create a per-user JSON repository with security and size limits. */
export function createUserJsonRepository<T>(filePath: string, containerPath: string, maxItems: number | undefined, uid: string): Repository<T> {
  return new FileJsonRepository<T>(filePath, uid, containerPath, maxItems);
}

/** Create a per-user provider events repository. */
export function createUserProviderEventsRepository(filePath: string, containerPath: string, uid: string): ProviderEventsRepository {
  return new FileProviderEventsRepository(filePath, containerPath, uid);
}

/** Create a per-user traces repository. */
export function createUserTracesRepository(filePath: string, containerPath: string, uid: string): TracesRepository {
  return new FileTracesRepository(filePath, containerPath, uid);
}

/** Create a per-user fetcher log repository. */
export function createUserFetcherLogRepository(filePath: string, containerPath: string, uid: string): FetcherLogRepository {
  return new FileFetcherLogRepository(filePath, containerPath, uid);
}

/** Create a per-user orchestration log repository. */
export function createUserOrchestrationLogRepository(filePath: string, containerPath: string, uid: string): OrchestrationLogRepository {
  return new FileOrchestrationLogRepository(filePath, containerPath, uid);
}

// ---- System-scoped repositories (no uid) ----

abstract class SystemPrunableFileRepo<T> extends SystemFileRepoBase {
  constructor(
    filePath: string,
    containerPath: string,
    private pruneOptions?: {
      ttlMs?: number | (() => number);
      maxItems?: number | (() => number);
      getTimestamp?: (item: T) => string | number | Date | undefined;
    }
  ) {
    super(filePath, containerPath);
  }

  protected pruneList(list: T[]): T[] {
    try {
      let next = list;
      const ttlVal = this.pruneOptions?.ttlMs;
      const ttlMs = typeof ttlVal === 'function' ? ttlVal() : ttlVal;
      if (ttlMs && ttlMs > 0) {
        const now = Date.now();
        const getTs = this.pruneOptions?.getTimestamp;
        if (getTs) {
          next = next.filter((item) => {
            const raw = getTs(item);
            let ts: number | undefined;
            if (raw instanceof Date) ts = raw.getTime();
            else if (typeof raw === 'number') ts = raw;
            else if (typeof raw === 'string') {
              const parsed = Date.parse(raw);
              ts = isNaN(parsed) ? undefined : parsed;
            }
            return ts === undefined ? true : (now - ts) <= ttlMs;
          });
        }
      }
      const maxVal = this.pruneOptions?.maxItems;
      const maxItems = typeof maxVal === 'function' ? maxVal() : maxVal;
      if (maxItems && maxItems > 0 && next.length > maxItems) {
        next = next.slice(Math.max(0, next.length - maxItems));
      }
      return next;
    } catch {
      return list;
    }
  }
}

class SystemFileJsonRepository<T> extends SystemPrunableFileRepo<T> implements Repository<T> {
  constructor(
    filePath: string,
    containerPath: string,
    maxItems?: number
  ) {
    super(filePath, containerPath, (typeof maxItems === 'number' ? { maxItems } : undefined));
  }

  async getAll(): Promise<T[]> {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = await persistence.loadAndDecrypt(this.filePath, this.containerPath) as T[];
        const fileStats = fs.statSync(this.filePath);
        this.logFileOperation('read', true, undefined, fileStats.size);
        return data;
      }
      this.logFileOperation('read', true, 'File does not exist');
      return [] as T[];
    } catch (e) {
      const error = e as Error;
      this.logFileOperation('read', false, error.message);
      logger.error('SystemFileJsonRepository.getAll failed', { filePath: this.filePath, error });
      throw new RepositoryError(`Failed to read repository file: ${this.filePath}`);
    }
  }

  private async writeAllUnlocked(next: T[]): Promise<void> {
    const items = this.pruneList(next);
    try {
      await persistence.encryptAndPersist(items, this.filePath, this.containerPath);
      const fileStats = fs.existsSync(this.filePath) ? fs.statSync(this.filePath) : null;
      this.logFileOperation('write', true, undefined, fileStats?.size);
    } catch (e) {
      const error = e as Error;
      this.logFileOperation('write', false, error.message);
      if (error.message.includes('size exceeds limit')) {
        throw new SecurityError(`File size limit exceeded: ${this.filePath}`);
      }
      logger.error('SystemFileJsonRepository.setAll failed', { filePath: this.filePath, error });
      throw error;
    }
  }

  async setAll(next: T[]): Promise<void> {
    await withFileLock(this.filePath, async () => {
      await this.writeAllUnlocked(next);
    });
  }
}

/** Create a system-level JSON repository (no uid). */
export function createSystemJsonRepository<T>(filePath: string, containerPath: string, maxItems?: number): Repository<T> {
  return new SystemFileJsonRepository<T>(filePath, containerPath, maxItems);
}
