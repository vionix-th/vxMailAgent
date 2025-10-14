import type { Request } from 'express';
import type { UserContext } from '../middleware/user-context';

export interface AppRequest extends Request {
  userContext: UserContext;
  traceId?: string;
}

export interface UserScopedContext {
  userContext: UserContext;
  traceId?: string;
}
