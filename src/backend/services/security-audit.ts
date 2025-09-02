import { promises as fs } from 'fs';
import path from 'path';
import { dataPath } from '../utils/paths';
import logger from './logger';

export interface SecurityAuditEvent {
  timestamp: string;
  uid?: string;
  operation: string;
  resource: string;
  details: Record<string, any>;
  severity: 'info' | 'warning' | 'error' | 'critical';
  userAgent?: string;
  ip?: string;
}

export interface FileOperationDetails {
  filePath: string;
  operation: 'read' | 'write' | 'delete' | 'create';
  success: boolean;
  error?: string;
  fileSize?: number;
}

export interface AuthOperationDetails {
  operation: 'login' | 'logout' | 'token_refresh' | 'access_denied';
  success: boolean;
  reason?: string;
}

export interface DataAccessDetails {
  resource: string;
  operation: 'get' | 'set' | 'delete' | 'list';
  recordCount?: number;
  success: boolean;
  error?: string;
}

class SecurityAuditService {
  private logPath: string;
  private maxLogSize = 50 * 1024 * 1024; // 50MB
  private maxLogFiles = 10;
  private logQueue: SecurityAuditEvent[] = [];
  private flushIntervalMs = 1000;
  private flushing = false;

  constructor() {
    this.logPath = dataPath('security-audit.log');
    setInterval(() => {
      this.flush().catch((err) =>
        logger.error('SECURITY-AUDIT flush failed', { err })
      );
    }, this.flushIntervalMs);
  }

  private async ensureLogDirectory(): Promise<void> {
    const dir = path.dirname(this.logPath);
    try {
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    } catch (error) {
      logger.error('SECURITY-AUDIT failed to ensure log directory', { err: error });
    }
  }

  private async rotateLogsIfNeeded(): Promise<void> {
    try {
      let stats;
      try {
        stats = await fs.stat(this.logPath);
      } catch (err: any) {
        if (err.code === 'ENOENT') return;
        throw err;
      }

      if (stats.size < this.maxLogSize) return;

      for (let i = this.maxLogFiles - 1; i > 0; i--) {
        const oldPath = `${this.logPath}.${i}`;
        const newPath = `${this.logPath}.${i + 1}`;
        try {
          await fs.access(oldPath);
        } catch {
          continue;
        }
        if (i === this.maxLogFiles - 1) {
          await fs.unlink(oldPath);
        } else {
          await fs.rename(oldPath, newPath);
        }
      }

      await fs.rename(this.logPath, `${this.logPath}.1`);
    } catch (error) {
      logger.error('SECURITY-AUDIT log rotation failed', { err: error });
    }
  }

  private async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    let entries: SecurityAuditEvent[] = [];
    try {
      if (this.logQueue.length === 0) return;
      entries = this.logQueue;
      this.logQueue = [];
      await this.ensureLogDirectory();
      await this.rotateLogsIfNeeded();
      const logLines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
      await fs.appendFile(this.logPath, logLines, { encoding: 'utf8', mode: 0o600 });
    } catch (error) {
      if (entries.length) this.logQueue.unshift(...entries);
      logger.error('SECURITY-AUDIT failed to write log entry', { err: error });
    } finally {
      this.flushing = false;
    }
  }

  private writeLogEntry(event: SecurityAuditEvent): void {
    this.logQueue.push(event);
  }

  logFileOperation(uid: string | undefined, details: FileOperationDetails, req?: any): void {
    const event: SecurityAuditEvent = {
      timestamp: new Date().toISOString(),
      uid,
      operation: 'file_operation',
      resource: details.filePath,
      details,
      severity: details.success ? 'info' : 'error',
      userAgent: req?.headers?.['user-agent'],
      ip: req?.ip || req?.connection?.remoteAddress,
    };
    
    this.writeLogEntry(event);
  }

  logAuthOperation(uid: string | undefined, details: AuthOperationDetails, req?: any): void {
    const event: SecurityAuditEvent = {
      timestamp: new Date().toISOString(),
      uid,
      operation: 'auth_operation',
      resource: 'authentication',
      details,
      severity: details.success ? 'info' : 'warning',
      userAgent: req?.headers?.['user-agent'],
      ip: req?.ip || req?.connection?.remoteAddress,
    };
    
    this.writeLogEntry(event);
  }

  logDataAccess(uid: string | undefined, details: DataAccessDetails, req?: any): void {
    const event: SecurityAuditEvent = {
      timestamp: new Date().toISOString(),
      uid,
      operation: 'data_access',
      resource: details.resource,
      details,
      severity: details.success ? 'info' : 'error',
      userAgent: req?.headers?.['user-agent'],
      ip: req?.ip || req?.connection?.remoteAddress,
    };
    
    this.writeLogEntry(event);
  }

  logSecurityViolation(uid: string | undefined, violation: string, details: Record<string, any>, req?: any): void {
    const event: SecurityAuditEvent = {
      timestamp: new Date().toISOString(),
      uid,
      operation: 'security_violation',
      resource: 'system',
      details: { violation, ...details },
      severity: 'critical',
      userAgent: req?.headers?.['user-agent'],
      ip: req?.ip || req?.connection?.remoteAddress,
    };
    
    this.writeLogEntry(event);
    
    // Also log via canonical logger for immediate attention
    logger.error('[SECURITY-VIOLATION]', { violation, details });
  }

  logPathTraversal(uid: string | undefined, attemptedPath: string, req?: any): void {
    this.logSecurityViolation(uid, 'path_traversal_attempt', {
      attemptedPath,
      blocked: true,
    }, req);
  }

  logUnauthorizedAccess(uid: string | undefined, resource: string, req?: any): void {
    this.logSecurityViolation(uid, 'unauthorized_access_attempt', {
      resource,
      blocked: true,
    }, req);
  }
}

export const securityAudit = new SecurityAuditService();
