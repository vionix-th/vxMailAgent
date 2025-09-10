import { JWT_SECRET } from '../config';
import { verifyJwt } from '../utils/jwt';

/** Verify a session token and return minimal user projection. */
export function getUserFromToken(token: string): { id: string; email?: string; name?: string; picture?: string } | null {
  try {
    const payload = verifyJwt(token, JWT_SECRET);
    if (!payload || typeof payload.uid !== 'string') return null;
    return { id: payload.uid, email: payload.email, name: payload.name, picture: payload.picture };
  } catch {
    return null;
  }
}
