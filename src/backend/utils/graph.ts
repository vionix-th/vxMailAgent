/**
 * Performs an HTTP request to the Microsoft Graph API and returns the parsed JSON body.
 * @param pathWithQuery Graph path including query string.
 * @param accessToken OAuth access token for authorization.
 * @param method HTTP method to use.
 * @param body Optional JSON payload string.
 */
import { GRAPH_REQUEST_TIMEOUT_MS } from '../config';
import https from 'https';

export async function graphRequest<T = any>(
  pathWithQuery: string,
  accessToken: string,
  method: 'GET' | 'POST' = 'GET',
  body?: string
): Promise<T> {
  const url = new URL('https://graph.microsoft.com');
  const options = {
    method,
    hostname: url.hostname,
    path: pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    } as any,
  };
  const payload = typeof body === 'string' ? body : undefined;
  const json = await new Promise<any>((resolve, reject) => {
    const req = https.request(options as any, (res: any) => {
      const chunks: Buffer[] = [];
      res.on('data', (d: any) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          const parsed = text ? JSON.parse(text) : {};
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject(new Error(`Graph error HTTP ${res.statusCode} ${res.statusMessage} ${text}`));
        } catch (e) {
          reject(new Error(`Graph invalid JSON ${text}`));
        }
      });
    });
    req.setTimeout(Math.max(1, GRAPH_REQUEST_TIMEOUT_MS || 0), () => {
      req.destroy(new Error(`graph_request_timeout_${GRAPH_REQUEST_TIMEOUT_MS}ms`));
    });
    req.on('error', (err: any) => reject(err));
    if (payload) req.write(payload);
    req.end();
  });
  return json as T;
}
