import jwt from 'jsonwebtoken';

export type VerifyJwtFailure = { reason: 'invalid' | 'expired' | 'malformed'; error: unknown };

export interface VerifyJwtOptions {
  onFailure?: (detail: VerifyJwtFailure) => void;
}

export function signJwt(payload: Record<string, any>, secret: string, opts?: { expiresInSec?: number }): string {
  const expiresIn = opts?.expiresInSec;
  // Let jsonwebtoken choose appropriate default algorithm for HMAC secret (HS256)
  return expiresIn !== undefined
    ? jwt.sign(payload, secret, { expiresIn })
    : jwt.sign(payload, secret);
}

export function verifyJwt(token: string, secret: string, opts?: VerifyJwtOptions): Record<string, any> | null {
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof decoded === 'string') return null;
    return decoded as Record<string, any>;
  } catch (error) {
    const reason = (() => {
      if (error && typeof error === 'object') {
        const name = (error as any).name;
        if (name === 'TokenExpiredError') return 'expired' as const;
        if (name === 'JsonWebTokenError') return 'invalid' as const;
      }
      return 'malformed' as const;
    })();
    opts?.onFailure?.({ reason, error });
    return null;
  }
}
