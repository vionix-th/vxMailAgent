import { Response } from 'express';
import { securityAudit } from './security-audit';
import logger from './logger';

export interface ErrorContext {
  uid?: string;
  operation: string;
  resource: string;
  userAgent?: string;
  ip?: string;
}

export class SecurityError extends Error {
  constructor(
    message: string,
    public code: string = 'SECURITY_ERROR',
    public statusCode: number = 403
  ) {
    super(message);
    this.name = 'SecurityError';
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public code: string = 'VALIDATION_ERROR',
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends Error {
  constructor(
    message: string,
    public code: string = 'AUTH_ERROR',
    public statusCode: number = 401
  ) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends Error {
  constructor(
    message: string,
    public code: string = 'AUTHZ_ERROR',
    public statusCode: number = 403
  ) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

class ErrorHandlerService {
  /**
   * Sanitizes error messages to prevent information leakage.
   */
  private sanitizeError(error: Error, context: ErrorContext): { message: string; code: string; statusCode: number } {
    // Known safe error types that can expose their messages
    if (error instanceof SecurityError || 
        error instanceof ValidationError || 
        error instanceof AuthenticationError || 
        error instanceof AuthorizationError) {
      return {
        message: error.message,
        code: error.code,
        statusCode: error.statusCode
      };
    }

    // File system errors - sanitize paths
    if (error.message.includes('ENOENT')) {
      return {
        message: 'Resource not found',
        code: 'RESOURCE_NOT_FOUND',
        statusCode: 404
      };
    }

    if (error.message.includes('EACCES') || error.message.includes('EPERM')) {
      securityAudit.logSecurityViolation(context.uid, 'file_permission_denied', {
        operation: context.operation,
        resource: context.resource,
        error: error.message
      });
      
      return {
        message: 'Access denied',
        code: 'ACCESS_DENIED',
        statusCode: 403
      };
    }

    // Path traversal attempts
    if (error.message.includes('Path traversal') || error.message.includes('Unsafe path')) {
      securityAudit.logPathTraversal(context.uid, context.resource);
      
      return {
        message: 'Invalid path',
        code: 'INVALID_PATH',
        statusCode: 400
      };
    }

    // JSON parsing errors
    if (error.message.includes('JSON') || error.name === 'SyntaxError') {
      return {
        message: 'Invalid data format',
        code: 'INVALID_FORMAT',
        statusCode: 400
      };
    }

    // Size limit errors
    if (error.message.includes('size exceeds limit')) {
      return {
        message: 'Data size exceeds limit',
        code: 'SIZE_LIMIT_EXCEEDED',
        statusCode: 413
      };
    }

    // User context errors
    if (error.message.includes('User context required')) {
      return {
        message: 'Authentication required',
        code: 'AUTH_REQUIRED',
        statusCode: 401
      };
    }

    // Default sanitized error for unknown types
    logger.error('[ERROR-HANDLER] Unhandled error type', { operation: context.operation, err: error });
    
    return {
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
      statusCode: 500
    };
  }

  /**
   * Handles errors and sends appropriate responses.
   */
  handleError(error: Error, res: Response, context: ErrorContext): void {
    const sanitized = this.sanitizeError(error, context);
    
    // Log the error with full details for debugging
    logger.error('[ERROR] operation failed', { operation: context.operation, uid: context.uid, resource: context.resource, error: error.message, stack: error.stack });

    // Send sanitized response to client
    res.status(sanitized.statusCode).json({
      success: false,
      error: sanitized.message,
      code: sanitized.code
    });
  }

  /**
   * Wraps async route handlers with error handling.
   */
  wrapAsync(handler: Function) {
    return async (req: any, res: Response, next: Function) => {
      try {
        await handler(req, res, next);
      } catch (error) {
        const context: ErrorContext = {
          uid: req.auth?.uid,
          operation: `${req.method} ${req.path}`,
          resource: req.path,
          userAgent: req.headers?.['user-agent'],
          ip: req.ip || req.connection?.remoteAddress
        };
        
        this.handleError(error as Error, res, context);
      }
    };
  }

  /**
   * Validates input and throws ValidationError if invalid.
   */
  validateInput(condition: boolean, message: string): void {
    if (!condition) {
      throw new ValidationError(message);
    }
  }

  /**
   * Validates user authorization and throws AuthorizationError if unauthorized.
   */
  validateAuthorization(condition: boolean, message: string = 'Access denied'): void {
    if (!condition) {
      throw new AuthorizationError(message);
    }
  }

  /**
   * Validates authentication and throws AuthenticationError if unauthenticated.
   */
  validateAuthentication(condition: boolean, message: string = 'Authentication required'): void {
    if (!condition) {
      throw new AuthenticationError(message);
    }
  }
}

export const errorHandler = new ErrorHandlerService();
