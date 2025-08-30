import { Request, Response, NextFunction } from 'express';
import { UserRequest, hasUserContext, getUserContext } from './user-context';

/**
 * Standard validation responses for consistent error handling.
 */
export const ValidationResponses = {
  missingUserContext: {
    status: 500,
    body: {
      error: 'Internal server error',
      message: 'User context setup failed'
    }
  },
  authRequired: {
    status: 401,
    body: {
      error: 'Authentication required',
      message: 'Valid authentication token required'
    }
  },
  invalidRequest: {
    status: 400,
    body: {
      error: 'Invalid request',
      message: 'Request validation failed'
    }
  }
} as const;

/**
 * Standardized middleware for requiring user context.
 * Replaces inconsistent validation patterns across routes.
 */
export function requireUserContext(req: UserRequest, res: Response, next: NextFunction): void {
  if (!req.userContext || !req.userContext.uid || !req.userContext.repos) {
    console.error('[VALIDATION] Missing user context in request');
    res.status(ValidationResponses.missingUserContext.status)
       .json(ValidationResponses.missingUserContext.body);
    return;
  }
  next();
}

/**
 * Middleware for routes that require authentication but not necessarily user context.
 */
export function requireAuth(req: UserRequest, res: Response, next: NextFunction): void {
  if (!req.auth || !req.auth.uid) {
    console.error('[VALIDATION] Missing authentication in request');
    res.status(ValidationResponses.authRequired.status)
       .json(ValidationResponses.authRequired.body);
    return;
  }
  next();
}

/**
 * Validation helper for request body parameters.
 */
export function validateRequestBody<T>(
  req: Request,
  validator: (body: any) => { isValid: boolean; errors: string[] },
  res: Response
): { isValid: boolean; data?: T } {
  const validation = validator(req.body);
  
  if (!validation.isValid) {
    console.error('[VALIDATION] Request body validation failed:', validation.errors);
    res.status(ValidationResponses.invalidRequest.status).json({
      ...ValidationResponses.invalidRequest.body,
      details: validation.errors
    });
    return { isValid: false };
  }
  
  return { isValid: true, data: req.body as T };
}

/**
 * Validation helper for query parameters.
 */
export function validateQueryParams<T>(
  req: Request,
  validator: (query: any) => { isValid: boolean; errors: string[] },
  res: Response
): { isValid: boolean; data?: T } {
  const validation = validator(req.query);
  
  if (!validation.isValid) {
    console.error('[VALIDATION] Query parameter validation failed:', validation.errors);
    res.status(ValidationResponses.invalidRequest.status).json({
      ...ValidationResponses.invalidRequest.body,
      details: validation.errors
    });
    return { isValid: false };
  }
  
  return { isValid: true, data: req.query as T };
}

/**
 * Common validators for typical request patterns.
 */
export const CommonValidators = {
  /**
   * Validates that required string fields are present and non-empty.
   */
  requiredStrings: (fields: string[]) => (data: any) => {
    const errors: string[] = [];
    
    for (const field of fields) {
      if (!data[field] || typeof data[field] !== 'string' || data[field].trim() === '') {
        errors.push(`${field} is required and must be a non-empty string`);
      }
    }
    
    return { isValid: errors.length === 0, errors };
  },

  /**
   * Validates that optional string fields are strings if present.
   */
  optionalStrings: (fields: string[]) => (data: any) => {
    const errors: string[] = [];
    
    for (const field of fields) {
      if (data[field] !== undefined && (typeof data[field] !== 'string')) {
        errors.push(`${field} must be a string if provided`);
      }
    }
    
    return { isValid: errors.length === 0, errors };
  },

  /**
   * Validates array fields.
   */
  arrays: (fields: { name: string; required?: boolean; itemValidator?: (item: any) => boolean }[]) => (data: any) => {
    const errors: string[] = [];
    
    for (const field of fields) {
      const value = data[field.name];
      
      if (field.required && (!value || !Array.isArray(value))) {
        errors.push(`${field.name} is required and must be an array`);
        continue;
      }
      
      if (value !== undefined && !Array.isArray(value)) {
        errors.push(`${field.name} must be an array if provided`);
        continue;
      }
      
      if (value && field.itemValidator) {
        for (let i = 0; i < value.length; i++) {
          if (!field.itemValidator(value[i])) {
            errors.push(`${field.name}[${i}] is invalid`);
          }
        }
      }
    }
    
    return { isValid: errors.length === 0, errors };
  }
};

/**
 * Helper to ensure user context exists and return it safely.
 */
export function ensureUserContext(req: UserRequest): { uid: string; repos: ReturnType<typeof getUserContext>['repos'] } {
  if (!hasUserContext(req)) {
    throw new Error('User context is required but not available');
  }
  return getUserContext(req);
}
