import crypto from 'crypto';

function base64url(input: Buffer | string): string {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return b.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlJson(obj: any): string {
  return base64url(Buffer.from(JSON.stringify(obj)));
}

export function signJwt(payload: Record<string, any>, secret: string, opts?: { expiresInSec?: number }): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = opts?.expiresInSec ? nowSec + opts.expiresInSec : undefined;
  const body = exp ? { ...payload, exp } : { ...payload };
  const headerB64 = b64urlJson(header);
  const payloadB64 = b64urlJson(body);
  const toSign = `${headerB64}.${payloadB64}`;
  const sig = crypto.createHmac('sha256', secret).update(toSign).digest();
  const sigB64 = base64url(sig);
  return `${toSign}.${sigB64}`;
}

export function verifyJwt(token: string, secret: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;
    const expected = base64url(crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest());
    if (s !== expected) return null;
    const payloadText = Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(payloadText);
    if (payload && typeof payload.exp === 'number') {
      const nowSec = Math.floor(Date.now() / 1000);
      if (nowSec >= payload.exp) return null;
    }
    return payload;
  } catch {
    return null;
  }
}
