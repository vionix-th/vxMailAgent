import { request as httpsRequest } from 'https';

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiryISO: string; // ISO string
  raw?: any;
}

export interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface OAuthProvider {
  buildAuthUrl(state: string): Promise<string> | string;
  exchangeCode(code: string, state?: string): Promise<OAuthTokens>;
  refresh(refreshToken: string): Promise<OAuthTokens>;
}

/** Compute an ISO timestamp for the given expiration offset in seconds. */
export function computeExpiryISO(expiresInSec?: number): string {
  const sec = typeof expiresInSec === 'number' && expiresInSec > 0 ? expiresInSec : 55 * 60;
  return new Date(Date.now() + sec * 1000).toISOString();
}

/** POST URL-encoded form data and parse the JSON response. */
export async function postForm<T = any>(urlStr: string, params: Record<string, string>): Promise<T> {
  const url = new URL(urlStr);
  const body = new URLSearchParams(params).toString();
  return await new Promise<T>((resolve, reject) => {
    const req = httpsRequest(
      {
        method: 'POST',
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            const parsed = text ? JSON.parse(text) : {};
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve(parsed as T);
            else reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage} ${text}`));
          } catch (e) {
            reject(new Error(`Invalid JSON response ${text}`));
          }
        });
      }
    );
    req.on('error', (err) => reject(err));
    req.write(body);
    req.end();
  });
}
