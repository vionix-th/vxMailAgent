import { Request, Response, NextFunction } from 'express';
import { validateUid } from '../utils/paths';
import { getUserRepoBundle, RepoBundle } from '../repository/registry';

/**
 * Extended request interface with user context.
 */
export interface UserRequest extends Request {
  auth?: { uid: string };
  userContext?: UserContext;
}

interface UserContext {
  uid: string;
  repos: RepoBundle;
}

/**
 * Security error for user context violations.
 */
export class UserContextError extends Error {
  constructor(message: string, public code: string = 'USER_CONTEXT_ERROR') {
    super(message);
    this.name = 'UserContextError';
  }
}

/**
 * Middleware to attach user context to requests.
 * Requires authentication middleware to run first.
 */
export function attachUserContext(req: UserRequest, res: Response, next: NextFunction): Response | void {
  try {
    
    // Require authentication
    if (!req.auth || !req.auth.uid) {
      throw new UserContextError('Authentication required for per-user mode', 'AUTH_REQUIRED');
    }
    
    const uid = String(req.auth.uid);
    
    // Validate UID for security
    if (!validateUid(uid)) {
      throw new UserContextError(`Invalid user ID: ${uid}`, 'INVALID_UID');
    }
    
    // Security check: forbid uid in request parameters or body
    if (req.params.uid || req.params.userId || req.query.uid || req.query.userId) {
      throw new UserContextError('User ID cannot be specified in request parameters', 'UID_IN_PARAMS');
    }
    
    if (req.body && (req.body.uid || req.body.userId)) {
      throw new UserContextError('User ID cannot be specified in request body', 'UID_IN_BODY');
    }
    
    // Get or create repository bundle for user
    const repos = getUserRepoBundle(uid);
    
    // Attach user context to request
    (req as UserRequest).userContext = {
      uid,
      repos,
    };
    
    next();
  } catch (error) {
    if (error instanceof UserContextError) {
      console.error(`[USER_CONTEXT] ${error.message}`, { uid: (req as UserRequest).auth?.uid, code: error.code });
      res.status(403).json({
        error: 'User context setup failed',
        message: error.message,
        code: error.code
      });
      return;
    }
    
    console.error('[USER_CONTEXT] Unexpected error:', error);
    res.status(500).json({
      error: 'Internal server error during user context setup',
      message: 'Failed to initialize user repositories'
    });
    return;
  }
}

/**
 * Middleware to require user context (fails if not present).
 */
export function requireUserContext(req: UserRequest, res: Response, next: NextFunction): void {
  
  if (!req.userContext || !req.userContext.uid || !req.userContext.repos) {
    console.error('[USER_CONTEXT] Missing user context in request');
    res.status(500).json({
      error: 'Internal server error',
      message: 'User context setup failed'
    });
    return;
  }
  
  next();
}

/**
 * Helper to get user context from request with validation.
 */
export function getUserContext(req: UserRequest): { uid: string; repos: RepoBundle } {
  
  if (!req.userContext) {
    throw new Error('User context not found in request');
  }
  
  return req.userContext;
}

/**
 * Helper to check if per-user mode is enabled and user context is available.
 */
export function hasUserContext(req: UserRequest): boolean {
  return !!req.userContext;
}
