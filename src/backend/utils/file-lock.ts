import fs from 'fs';
import path from 'path';
import { logger } from '../services/logger';

/**
 * File-based mutex implementation for coordinating repository operations.
 * Uses atomic file creation as a locking primitive.
 */
export class FileLock {
  private lockPath: string;
  private acquired = false;
  private lockTimeout: NodeJS.Timeout | null = null;

  constructor(
    private filePath: string,
    private timeoutMs: number = 5000,
    private retryIntervalMs: number = 50
  ) {
    this.lockPath = `${filePath}.lock`;
  }

  /**
   * Acquire exclusive lock on the file.
   * Uses atomic file creation with process PID for deadlock detection.
   */
  async acquire(): Promise<void> {
    const startTime = Date.now();
    const lockData = {
      pid: process.pid,
      timestamp: startTime,
      file: this.filePath
    };

    while (Date.now() - startTime < this.timeoutMs) {
      try {
        // Atomic lock acquisition via exclusive file creation
        await fs.promises.writeFile(
          this.lockPath, 
          JSON.stringify(lockData), 
          { flag: 'wx', mode: 0o600 }
        );
        
        this.acquired = true;
        
        // Set cleanup timeout as safety net
        this.lockTimeout = setTimeout(() => {
          this.forceRelease();
        }, this.timeoutMs * 2);
        
        return;
      } catch (error: any) {
        if (error.code !== 'EEXIST') {
          throw new Error(`Lock acquisition failed: ${error.message}`);
        }
        
        // Check for stale locks
        await this.cleanupStaleLock();
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, this.retryIntervalMs));
      }
    }
    
    throw new Error(`Lock timeout after ${this.timeoutMs}ms for ${this.filePath}`);
  }

  /**
   * Release the acquired lock.
   */
  async release(): Promise<void> {
    if (!this.acquired) return;
    
    try {
      await fs.promises.unlink(this.lockPath);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.warn('Lock release failed', { lockPath: this.lockPath, error: error.message });
      }
    }
    
    this.acquired = false;
    
    if (this.lockTimeout) {
      clearTimeout(this.lockTimeout);
      this.lockTimeout = null;
    }
  }

  /**
   * Execute function with exclusive file lock.
   */
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      await this.release();
    }
  }

  /**
   * Clean up stale locks from dead processes.
   */
  private async cleanupStaleLock(): Promise<void> {
    try {
      const lockContent = await fs.promises.readFile(this.lockPath, 'utf8');
      const lockData = JSON.parse(lockContent);
      
      // Check if process is still alive
      try {
        process.kill(lockData.pid, 0); // Signal 0 checks existence without killing
      } catch {
        // Process is dead, remove stale lock
        await fs.promises.unlink(this.lockPath);
        logger.info('Removed stale lock', { lockPath: this.lockPath, stalePid: lockData.pid });
      }
    } catch {
      // Lock file is corrupted or unreadable, remove it
      try {
        await fs.promises.unlink(this.lockPath);
      } catch {}
    }
  }

  /**
   * Force release lock (cleanup timeout handler).
   */
  private forceRelease(): void {
    if (this.acquired) {
      logger.warn('Force releasing lock due to timeout', { lockPath: this.lockPath });
      fs.promises.unlink(this.lockPath).catch(() => {});
      this.acquired = false;
    }
  }
}

/**
 * Global lock registry to prevent multiple locks on same file within process.
 */
class LockRegistry {
  private locks = new Map<string, FileLock>();

  getLock(filePath: string, timeoutMs?: number): FileLock {
    const normalizedPath = path.resolve(filePath);
    
    if (!this.locks.has(normalizedPath)) {
      this.locks.set(normalizedPath, new FileLock(normalizedPath, timeoutMs));
    }
    
    return this.locks.get(normalizedPath)!;
  }

  async releaseAll(): Promise<void> {
    const releases = Array.from(this.locks.values()).map(lock => lock.release());
    await Promise.allSettled(releases);
    this.locks.clear();
  }
}

export const lockRegistry = new LockRegistry();

/**
 * Convenience function to execute code with file lock.
 */
export async function withFileLock<T>(
  filePath: string, 
  fn: () => Promise<T>,
  timeoutMs?: number
): Promise<T> {
  const lock = lockRegistry.getLock(filePath, timeoutMs);
  return lock.withLock(fn);
}
