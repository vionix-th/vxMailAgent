import jwt from 'jsonwebtoken';

export function signJwt(payload: Record<string, any>, secret: string, opts?: { expiresInSec?: number }): string {
  const expiresIn = opts?.expiresInSec;
  // Let jsonwebtoken choose appropriate default algorithm for HMAC secret (HS256)
  return expiresIn !== undefined
    ? jwt.sign(payload, secret, { expiresIn })
    : jwt.sign(payload, secret);
}

export function verifyJwt(token: string, secret: string): Record<string, any> | null {
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof decoded === 'string') return null;
    return decoded as Record<string, any>;
  } catch {
    return null;
  }
}
