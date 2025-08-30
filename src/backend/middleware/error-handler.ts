import { Request, Response, NextFunction } from 'express';
import { UserContextError } from './user-context';

/**
 * Standard error response interface for consistent API responses.
 */
export interface ErrorResponse {
  error: string;
  message: string;
  code?: string;
  details?: string[];
  timestamp: string;
  path: string;
}

/**
 * Known error types with their standard HTTP status codes.
 */
export const ErrorTypes = {
  VALIDATION_ERROR: { status: 400, code: 'VALIDATION_ERROR' },
  AUTHENTICATION_ERROR: { status: 401, code: 'AUTHENTICATION_ERROR' },
  AUTHORIZATION_ERROR: { status: 403, code: 'AUTHORIZATION_ERROR' },
  NOT_FOUND_ERROR: { status: 404, code: 'NOT_FOUND_ERROR' },
  CONFLICT_ERROR: { status: 409, code: 'CONFLICT_ERROR' },
  INTERNAL_ERROR: { status: 500, code: 'INTERNAL_ERROR' },
  SERVICE_UNAVAILABLE: { status: 503, code: 'SERVICE_UNAVAILABLE' }
} as const;

/**
 * Custom application error class with structured error information.
 */
export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: string[];
  public readonly isOperational: boolean;

  constructor(
    message: string,
    status: number = 500,
    code: string = 'INTERNAL_ERROR',
    details?: string[],
    isOperational: boolean = true
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;

    // Maintain proper stack trace
    Error.captureStackTrace(this, AppError);
  }

  /**
   * Create a validation error.
   */
  static validation(message: string, details?: string[]): AppError {
    return new AppError(
      message,
      ErrorTypes.VALIDATION_ERROR.status,
      ErrorTypes.VALIDATION_ERROR.code,
      details
    );
  }

  /**
   * Create an authentication error.
   */
  static authentication(message: string): AppError {
    return new AppError(
      message,
      ErrorTypes.AUTHENTICATION_ERROR.status,
      ErrorTypes.AUTHENTICATION_ERROR.code
    );
  }

  /**
   * Create an authorization error.
   */
  static authorization(message: string): AppError {
    return new AppError(
      message,
      ErrorTypes.AUTHORIZATION_ERROR.status,
      ErrorTypes.AUTHORIZATION_ERROR.code
    );
  }

  /**
   * Create a not found error.
   */
  static notFound(message: string): AppError {
    return new AppError(
      message,
      ErrorTypes.NOT_FOUND_ERROR.status,
      ErrorTypes.NOT_FOUND_ERROR.code
    );
  }

  /**
   * Create a conflict error.
   */
  static conflict(message: string): AppError {
    return new AppError(
      message,
      ErrorTypes.CONFLICT_ERROR.status,
      ErrorTypes.CONFLICT_ERROR.code
    );
  }

  /**
   * Create an internal server error.
   */
  static internal(message: string): AppError {
    return new AppError(
      message,
      ErrorTypes.INTERNAL_ERROR.status,
      ErrorTypes.INTERNAL_ERROR.code,
      undefined,
      false // Internal errors are not operational
    );
  }
}

/**
 * Global error handler middleware that provides consistent error responses.
 */
export function globalErrorHandler(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Don't handle if response already sent
  if (res.headersSent) {
    return next(error);
  }

  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Internal server error';
  let details: string[] | undefined;

  // Handle different error types
  if (error instanceof AppError) {
    status = error.status;
    code = error.code;
    message = error.message;
    details = error.details;
  } else if (error instanceof UserContextError) {
    status = 403;
    code = error.code;
    message = error.message;
  } else if (error.name === 'ValidationError') {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = error.message;
  } else if (error.name === 'UnauthorizedError') {
    status = 401;
    code = 'AUTHENTICATION_ERROR';
    message = 'Authentication required';
  } else {
    // Log unexpected errors
    console.error('[ERROR_HANDLER] Unexpected error:', {
      message: error.message,
      stack: error.stack,
      path: req.path,
      method: req.method,
      timestamp: new Date().toISOString()
    });
  }

  // Create standardized error response
  const errorResponse: ErrorResponse = {
    error: 'Request failed',
    message,
    code,
    details,
    timestamp: new Date().toISOString(),
    path: req.path
  };

  // Send error response
  res.status(status).json(errorResponse);
}

/**
 * Async error wrapper for route handlers.
 * Catches async errors and passes them to the error handler.
 */
export function asyncHandler<T extends Request, U extends Response>(
  fn: (req: T, res: U, next: NextFunction) => Promise<void>
) {
  return (req: T, res: U, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Not found handler for unmatched routes.
 */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  const error = AppError.notFound(`Route ${req.method} ${req.path} not found`);
  next(error);
}

/**
 * Helper to safely execute operations with error boundaries.
 */
export async function safeExecute<T>(
  operation: () => Promise<T>,
  errorMessage: string = 'Operation failed'
): Promise<{ success: true; data: T } | { success: false; error: AppError }> {
  try {
    const data = await operation();
    return { success: true, data };
  } catch (error) {
    console.error(`[SAFE_EXECUTE] ${errorMessage}:`, error);
    
    if (error instanceof AppError) {
      return { success: false, error };
    }
    
    return { 
      success: false, 
      error: AppError.internal(`${errorMessage}: ${error instanceof Error ? error.message : 'Unknown error'}`)
    };
  }
}
