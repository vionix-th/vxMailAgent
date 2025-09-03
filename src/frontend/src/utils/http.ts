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
  const hasJsonContent = contentType.includes('application/json');
  
  // If explicitly expecting JSON or content-type indicates JSON
  if (expectJson === true || (expectJson !== false && hasJsonContent)) {
    return res.json();
  }
  
  // For non-JSON responses or empty bodies, return undefined
  return undefined as unknown as T;
}

/**
 * Alias for apiFetch - maintains compatibility with existing fetchJSON usage
 */
export const fetchJSON = apiFetch;
