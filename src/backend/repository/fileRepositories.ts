import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import logger from '../services/logger';
import * as persistence from '../persistence';
import { Repository } from './core';
import { ProviderEvent, Trace, FetcherLogEntry, OrchestrationEvent } from '../../shared/types';
import { TRACE_TTL_DAYS, PROVIDER_TTL_DAYS, USER_MAX_LOGS_PER_TYPE, FETCHER_TTL_DAYS, ORCHESTRATION_TTL_DAYS, VX_MAILAGENT_KEY, isProd } from '../config';
import { securityAudit } from '../services/security-audit';
import { SecurityError, RepositoryError } from '../services/error-handler';
import { withFileLock } from '../utils/file-lock';
import { validatePathSafety } from '../utils/paths';

// ---- NDJSON journal helpers (atomic append, optional per-record encryption) ----

const JOURNAL_SUFFIX = '.ndjson';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const ENC = 'base64';
const COMPACT_JOURNAL_MAX_LINES = 5000; // compact when journal grows beyond this

function journalPath(filePath: string): string {
  return filePath.replace(/\.json$/i, JOURNAL_SUFFIX);
}

function getKeyBuf(): Buffer | undefined {
  return (VX_MAILAGENT_KEY && VX_MAILAGENT_KEY.length === 64) ? Buffer.from(VX_MAILAGENT_KEY, 'hex') : undefined;
}

function encryptObjectToPayload(obj: any, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const json = JSON.stringify(obj);
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString(ENC);
}

function decryptPayloadToObject(payload: string, key: Buffer): any {
  const buf = Buffer.from(payload, ENC);
  const iv = buf.slice(0, IV_LENGTH);
  const tag = buf.slice(IV_LENGTH, IV_LENGTH + 16);
  const encrypted = buf.slice(IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const json = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  return JSON.parse(json);
}

async function appendNdjsonLine(containerPath: string, ndjsonPath: string, entry: any): Promise<void> {
  if (!validatePathSafety(ndjsonPath, containerPath)) {
    throw new SecurityError(`Unsafe NDJSON path: ${ndjsonPath}`);
  }
  const dir = path.dirname(ndjsonPath);
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });

  const key = getKeyBuf();
  if (isProd && !key) {
    throw new RepositoryError('Encrypted append required in production, but VX_MAILAGENT_KEY is invalid');
  }
  const lineObj = key ? { _enc: encryptObjectToPayload(entry, key) } : entry;
  const line = JSON.stringify(lineObj) + '\n';
  await fs.promises.appendFile(ndjsonPath, line, { encoding: 'utf8', mode: 0o600, flag: 'a' });
}

async function readNdjson(containerPath: string, ndjsonPath: string): Promise<any[]> {
  if (!fs.existsSync(ndjsonPath)) return [];
  if (!validatePathSafety(ndjsonPath, containerPath)) {
    throw new SecurityError(`Unsafe NDJSON path: ${ndjsonPath}`);
  }
  const text = await fs.promises.readFile(ndjsonPath, 'utf8');
  const key = getKeyBuf();
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  const out: any[] = [];
  for (const ln of lines) {
    try {
      const obj = JSON.parse(ln);
      if (obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, '_enc')) {
        if (!key) {
          if (isProd) throw new RepositoryError('Encrypted journal entry encountered without valid key');
          // dev fallback: skip unreadable encrypted entries
          continue;
        }
        out.push(decryptPayloadToObject(String(obj._enc || ''), key));
      } else {
        out.push(obj);
      }
    } catch {
      // tolerate json parse errors on individual lines
    }
  }
  return out;
}

async function compactJournalIfNeeded<T>(containerPath: string, jsonPath: string, list: T[]): Promise<void> {
  const ndPath = journalPath(jsonPath);
  try {
    if (!fs.existsSync(ndPath)) return;
    const stat = await fs.promises.stat(ndPath);
    // rough heuristic: compact by line count estimate (file size / 200 bytes) or if size > 10MB
    const approxLines = Math.ceil(stat.size / 200);
    if (approxLines < COMPACT_JOURNAL_MAX_LINES && stat.size < 10 * 1024 * 1024) return;
  } catch {
    return;
  }
  // Compact: write full snapshot and truncate journal
  await withFileLock(jsonPath, async () => {
    await persistence.encryptAndPersist(list, jsonPath, containerPath);
  });
  try { await fs.promises.truncate(ndPath, 0); } catch { /* ignore */ }
}

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

/** Shared prune utility for TTL and max-items logic. */
export function pruneItems<T>(list: T[], options?: {
  ttlMs?: number | (() => number);
  maxItems?: number | (() => number);
  getTimestamp?: (item: T) => string | number | Date | undefined;
}): T[] {
  try {
    let next = list;
    // TTL pruning
    const ttlVal = options?.ttlMs;
    const ttlMs = typeof ttlVal === 'function' ? ttlVal() : ttlVal;
    if (ttlMs && ttlMs > 0) {
      const now = Date.now();
      const getTs = options?.getTimestamp;
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
    const maxVal = options?.maxItems;
    const maxItems = typeof maxVal === 'function' ? maxVal() : maxVal;
    if (maxItems && maxItems > 0 && next.length > maxItems) {
      next = next.slice(Math.max(0, next.length - maxItems));
    }

    return next;
  } catch {
    return list;
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
    return pruneItems(list, this.pruneOptions);
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
      const snapshot = fs.existsSync(this.filePath)
        ? (await persistence.loadAndDecrypt(this.filePath, this.containerPath) as FetcherLogEntry[])
        : [];
      const journal = await readNdjson(this.containerPath, journalPath(this.filePath)) as FetcherLogEntry[];
      const merged = this.pruneList([...snapshot, ...journal]);
      await compactJournalIfNeeded(this.containerPath, this.filePath, merged);
      const fileStats = fs.existsSync(this.filePath) ? fs.statSync(this.filePath) : undefined;
      this.logFileOperation('read', true, undefined, fileStats?.size);
      return merged;
    } catch (e) {
      const error = e as Error;
      this.logFileOperation('read', false, error.message);
      logger.error('FileFetcherLogRepository.getAll failed', { errorMessage: (e as any)?.message || String(e), errorStack: (e as any)?.stack, filePath: this.filePath, containerPath: this.containerPath });
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
    const ndPath = journalPath(this.filePath);
    await withFileLock(ndPath, async () => {
      await appendNdjsonLine(this.containerPath, ndPath, e);
      this.logFileOperation('write', true);
    });
  }
}

/** Repository interface for orchestration events log. */
export interface OrchestrationLogRepository extends Repository<OrchestrationEvent> {
  append(e: OrchestrationEvent): Promise<void>;
}

/** Orchestration events repository with TTL + cap pruning. */
export class FileOrchestrationLogRepository extends PrunableFileRepo<OrchestrationEvent> implements OrchestrationLogRepository {
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

  async getAll(): Promise<OrchestrationEvent[]> {
    try {
      const snapshot = fs.existsSync(this.filePath)
        ? (await persistence.loadAndDecrypt(this.filePath, this.containerPath) as OrchestrationEvent[])
        : [];
      const journal = await readNdjson(this.containerPath, journalPath(this.filePath)) as OrchestrationEvent[];
      const merged = this.pruneList([...snapshot, ...journal]);
      await compactJournalIfNeeded(this.containerPath, this.filePath, merged);
      const fileStats = fs.existsSync(this.filePath) ? fs.statSync(this.filePath) : undefined;
      this.logFileOperation('read', true, undefined, fileStats?.size);
      return merged;
    } catch (e) {
      const error = e as Error;
      this.logFileOperation('read', false, error.message);
      logger.error('FileOrchestrationLogRepository.getAll failed', { errorMessage: (e as any)?.message || String(e), errorStack: (e as any)?.stack, filePath: this.filePath, containerPath: this.containerPath });
      throw new RepositoryError(`Failed to read orchestration log file: ${this.filePath}`);
    }
  }

  /** Internal write that assumes caller coordinates locking. */
  private async writeAllUnlocked(next: OrchestrationEvent[]): Promise<void> {
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

  async setAll(next: OrchestrationEvent[]): Promise<void> {
    await withFileLock(this.filePath, async () => {
      await this.writeAllUnlocked(next);
    });
  }

  async append(e: OrchestrationEvent): Promise<void> {
    const ndPath = journalPath(this.filePath);
    await withFileLock(ndPath, async () => {
      await appendNdjsonLine(this.containerPath, ndPath, e);
      this.logFileOperation('write', true);
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
      const snapshot = fs.existsSync(this.filePath)
        ? (await persistence.loadAndDecrypt(this.filePath, this.containerPath) as ProviderEvent[])
        : [];
      const journal = await readNdjson(this.containerPath, journalPath(this.filePath)) as ProviderEvent[];
      const merged = this.pruneList([...snapshot, ...journal]);
      await compactJournalIfNeeded(this.containerPath, this.filePath, merged);
      const fileStats = fs.existsSync(this.filePath) ? fs.statSync(this.filePath) : undefined;
      this.logFileOperation('read', true, undefined, fileStats?.size);
      return merged;
    } catch (e) {
      const error = e as Error;
      this.logFileOperation('read', false, error.message);
      logger.error('FileProviderEventsRepository.getAll failed', { errorMessage: (e as any)?.message || String(e), errorStack: (e as any)?.stack, filePath: this.filePath, containerPath: this.containerPath });
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
    const ndPath = journalPath(this.filePath);
    await withFileLock(ndPath, async () => {
      await appendNdjsonLine(this.containerPath, ndPath, ev);
      this.logFileOperation('write', true);
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
      const snapshot = fs.existsSync(this.filePath)
        ? (await persistence.loadAndDecrypt(this.filePath, this.containerPath) as Trace[])
        : [];
      const journal = await readNdjson(this.containerPath, journalPath(this.filePath)) as Trace[];
      const merged = this.pruneList([...snapshot, ...journal]);
      await compactJournalIfNeeded(this.containerPath, this.filePath, merged);
      const fileStats = fs.existsSync(this.filePath) ? fs.statSync(this.filePath) : undefined;
      this.logFileOperation('read', true, undefined, fileStats?.size);
      return merged;
    } catch (e) {
      const error = e as Error;
      this.logFileOperation('read', false, error.message);
      logger.error('FileTracesRepository.getAll failed', { errorMessage: (e as any)?.message || String(e), errorStack: (e as any)?.stack, filePath: this.filePath, containerPath: this.containerPath });
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
    const ndPath = journalPath(this.filePath);
    await withFileLock(ndPath, async () => {
      await appendNdjsonLine(this.containerPath, ndPath, t);
      this.logFileOperation('write', true);
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
  return new FileProviderEventsRepository(filePath, uid, containerPath);
}

/** Create a per-user traces repository. */
export function createUserTracesRepository(filePath: string, containerPath: string, uid: string): TracesRepository {
  return new FileTracesRepository(filePath, uid, containerPath);
}

/** Create a per-user fetcher log repository. */
export function createUserFetcherLogRepository(filePath: string, containerPath: string, uid: string): FetcherLogRepository {
  return new FileFetcherLogRepository(filePath, uid, containerPath);
}

/** Create a per-user orchestration log repository. */
export function createUserOrchestrationLogRepository(filePath: string, containerPath: string, uid: string): OrchestrationLogRepository {
  return new FileOrchestrationLogRepository(filePath, uid, containerPath);
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
    return pruneItems(list, this.pruneOptions);
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
