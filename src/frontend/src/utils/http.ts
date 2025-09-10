/**
 * Shared HTTP utility providing consistent error handling and response parsing.
 * Supports both JSON and non-JSON responses (e.g., DELETE returning no body).
 */

export interface FetchOptions extends RequestInit {
  /** If true, expects JSON response. If false, returns undefined for empty responses. Default: auto-detect */
  expectJson?: boolean;
  /** Query parameters to append to URL */
  params?: Record<string, string | number | boolean | undefined>;
}

/**
 * Enhanced fetch wrapper with consistent error handling.
 * Automatically detects JSON responses or returns undefined for empty bodies.
 */
export async function apiFetch<T = any>(url: string, options: FetchOptions = {}): Promise<T> {
  const { expectJson, params, ...rest } = options;
  
  // Build URL with query parameters
  let finalUrl = url;
  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        searchParams.append(key, String(value));
      }
    });
    const queryString = searchParams.toString();
    if (queryString) {
      finalUrl += (url.includes('?') ? '&' : '?') + queryString;
    }
  }
  
  // Always include credentials (cookies) by default for authenticated endpoints; allow override via options
  const init: RequestInit = { ...rest, credentials: rest.credentials ?? 'include' };
  
  const res = await fetch(finalUrl, init);
  
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
 * Like apiFetch but returns both the parsed data and the raw Response object.
 * Useful for reading response headers while retaining uniform error handling.
 */
export async function apiFetchWithResponse<T = any>(url: string, options: FetchOptions = {}): Promise<{ data: T; response: Response }> {
  const { expectJson, ...rest } = options;
  const init: RequestInit = { ...rest, credentials: rest.credentials ?? 'include' };

  const res = await fetch(url, init);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text}` : ''}`);
  }

  const contentType = res.headers.get('content-type') || '';
  const contentLength = res.headers.get('content-length');
  const hasJsonContent = contentType.includes('application/json');
  if (res.status === 204 || (contentLength !== null && Number(contentLength) === 0)) {
    return { data: undefined as unknown as T, response: res };
  }

  if (expectJson === true || (expectJson !== false && hasJsonContent)) {
    try {
      const data = await res.json();
      return { data, response: res };
    } catch (e: any) {
      if (e instanceof SyntaxError) return { data: undefined as unknown as T, response: res };
      throw e;
    }
  }

  return { data: undefined as unknown as T, response: res };
}

/**
 * Alias for apiFetch - maintains compatibility with existing fetchJSON usage
 */
export const fetchJSON = apiFetch;

/**
 * Low-level helper that mirrors window.fetch but defaults credentials to 'include'.
 * Does not throw on non-OK. Returns the raw Response.
 */
export async function apiFetchRaw(url: string, options: RequestInit = {}): Promise<Response> {
  const init: RequestInit = { ...options, credentials: options.credentials ?? 'include' };
  return fetch(url, init);
}
