import { JWT_SECRET } from '../config';
import { verifyJwt } from '../utils/jwt';
import logger from './logger';
import { securityAudit } from './security-audit';

/** Verify a session token and return minimal user projection. */
export function getUserFromToken(token: string): { id: string; email?: string; name?: string; picture?: string } | null {
  let tokenFailureReason: 'invalid' | 'expired' | 'malformed' | null = null;
  const payload = verifyJwt(token, JWT_SECRET, {
    onFailure: ({ reason }) => {
      tokenFailureReason = reason;
    },
  });
  if (!payload || typeof payload.uid !== 'string') {
    const reason = tokenFailureReason ?? 'missing_uid';
    logger.warn('Auth service: failed to resolve user from token', { reason });
    securityAudit.logAuthOperation(undefined, { operation: 'access_denied', success: false, reason: `jwt_${reason}` });
    return null;
  }
  return { id: payload.uid, email: payload.email, name: payload.name, picture: payload.picture };
}
