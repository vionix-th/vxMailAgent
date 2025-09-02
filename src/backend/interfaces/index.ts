import type { UserContext } from '../middleware/user-context';

export interface ReqLike {
  userContext?: UserContext;
}
