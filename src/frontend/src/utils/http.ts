/**
 * Shared HTTP utility providing consistent error handling and response parsing.
 * Supports both JSON and non-JSON responses (e.g., DELETE returning no body).
 */

export interface FetchOptions extends RequestInit {
  /** If true, expects JSON response. If false, returns undefined for empty responses. Default: auto-detect */
  expectJson?: boolean;
}

/**
 * Enhanced fetch wrapper with consistent error handling.
 * Automatically detects JSON responses or returns undefined for empty bodies.
 */
export async function apiFetch<T = any>(url: string, options: FetchOptions = {}): Promise<T> {
  const { expectJson, ...init } = options;
  
  const res = await fetch(url, init);
  
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text}` : ''}`);
  }

  // Handle empty responses (common for DELETE operations)
  const contentType = res.headers.get('content-type') || '';
  const contentLength = res.headers.get('content-length');
  const hasJsonContent = contentType.includes('application/json');
  // If HTTP 204 No Content or explicit zero content length, return undefined
  if (res.status === 204 || (contentLength !== null && Number(contentLength) === 0)) {
    return undefined as unknown as T;
  }
  
  // If explicitly expecting JSON or content-type indicates JSON
  if (expectJson === true || (expectJson !== false && hasJsonContent)) {
    try {
      return await res.json();
    } catch (e: any) {
      // Some servers may send empty body with JSON content-type; tolerate and return undefined
      if (e instanceof SyntaxError) return undefined as unknown as T;
      throw e;
    }
  }
  
  // For non-JSON responses or empty bodies, return undefined
  return undefined as unknown as T;
}

/**
 * Alias for apiFetch - maintains compatibility with existing fetchJSON usage
 */
export const fetchJSON = apiFetch;
