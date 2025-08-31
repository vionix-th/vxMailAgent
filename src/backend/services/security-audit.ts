import fs from 'fs';
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

  constructor() {
    this.logPath = dataPath('security-audit.log');
    this.ensureLogDirectory();
  }

  private ensureLogDirectory(): void {
    const dir = path.dirname(this.logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }

  private rotateLogsIfNeeded(): void {
    try {
      if (!fs.existsSync(this.logPath)) return;
      
      const stats = fs.statSync(this.logPath);
      if (stats.size < this.maxLogSize) return;

      // Rotate logs
      for (let i = this.maxLogFiles - 1; i > 0; i--) {
        const oldPath = `${this.logPath}.${i}`;
        const newPath = `${this.logPath}.${i + 1}`;
        
        if (fs.existsSync(oldPath)) {
          if (i === this.maxLogFiles - 1) {
            fs.unlinkSync(oldPath); // Delete oldest
          } else {
            fs.renameSync(oldPath, newPath);
          }
        }
      }
      
      // Move current log to .1
      fs.renameSync(this.logPath, `${this.logPath}.1`);
    } catch (error) {
      logger.error('SECURITY-AUDIT log rotation failed', { err: error });
    }
  }

  private writeLogEntry(event: SecurityAuditEvent): void {
    try {
      this.rotateLogsIfNeeded();
      
      const logLine = JSON.stringify(event) + '\n';
      fs.appendFileSync(this.logPath, logLine, { encoding: 'utf8', mode: 0o600 });
    } catch (error) {
      logger.error('SECURITY-AUDIT failed to write log entry', { err: error });
    }
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
