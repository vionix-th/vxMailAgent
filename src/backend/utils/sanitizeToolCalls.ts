import { OPTIONAL_TOOL_NAMES } from '../../shared/tools';

/**
 * Sanitize an unknown "enabledToolCalls" value coming from the client.
 * - Accepts only arrays of strings.
 * - Filters values to the known OPTIONAL_TOOL_NAMES allowlist.
 * - Returns undefined when input is not an array (treat as omitted), otherwise returns a possibly-empty array.
 */
export function sanitizeEnabled(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string') continue;
    if ((OPTIONAL_TOOL_NAMES as readonly string[]).includes(x)) { out.push(x); continue; }
  }
  return out.length ? out : [];
}
