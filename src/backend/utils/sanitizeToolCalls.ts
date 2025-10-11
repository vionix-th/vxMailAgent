import { OPTIONAL_TOOL_NAMES } from '../../shared/tools';

/**
 * Sanitize an unknown "enabledOptionalTools" value coming from the client.
 * - Accepts only arrays of strings.
 * - Filters values to the known OPTIONAL_TOOL_NAMES allowlist.
 * - Returns null when input is not an array (treat as omitted), otherwise returns a possibly-empty array.
 */
export function sanitizeEnabledOptionalTools(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string') continue;
    if ((OPTIONAL_TOOL_NAMES as readonly string[]).includes(x)) { out.push(x); continue; }
  }
  return out.length ? out : [];
}
