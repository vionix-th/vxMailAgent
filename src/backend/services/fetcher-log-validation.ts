import { ValidationError } from './error-handler';
import type { AccountProvider, FetcherLogEntry, FetcherLogLevel } from '../../shared/types';

const VALID_LEVELS: ReadonlySet<FetcherLogLevel> = new Set(['debug', 'info', 'warn', 'error']);
const VALID_PROVIDERS: ReadonlySet<AccountProvider> = new Set(['gmail', 'outlook']);

function fail(field: string, message: string, code: string): never {
  throw new ValidationError(`${field}: ${message}`, code);
}

function ensureNonEmptyString(value: unknown, field: string, code: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    fail(field, 'must be a non-empty string', code);
  }
  return value;
}

function ensureTimestamp(value: unknown, field: string): string {
  const timestamp = ensureNonEmptyString(value, field, 'FETCHER_LOG_INVALID_TIMESTAMP');
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    fail(field, 'must be a valid ISO-8601 timestamp', 'FETCHER_LOG_INVALID_TIMESTAMP');
  }
  return timestamp;
}

function ensureLevel(value: unknown, field: string): FetcherLogLevel {
  if (typeof value !== 'string' || !VALID_LEVELS.has(value as FetcherLogLevel)) {
    fail(field, `must be one of ${Array.from(VALID_LEVELS).join(', ')}`, 'FETCHER_LOG_INVALID_LEVEL');
  }
  return value as FetcherLogLevel;
}

function ensureProvider(value: unknown, field: string): AccountProvider | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    fail(field, 'must be null or a supported provider name', 'FETCHER_LOG_INVALID_PROVIDER');
  }
  if (!VALID_PROVIDERS.has(value as AccountProvider)) {
    fail(field, `must be one of ${Array.from(VALID_PROVIDERS).join(', ')} when provided`, 'FETCHER_LOG_INVALID_PROVIDER');
  }
  return value as AccountProvider;
}

function ensureStringOrNull(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value === 'undefined') {
    fail(field, 'must be provided (use null when absent)', 'FETCHER_LOG_INVALID_FIELD');
  }
  if (typeof value !== 'string') {
    fail(field, 'must be a string or null', 'FETCHER_LOG_INVALID_FIELD');
  }
  return value;
}

function ensureOptionalNumber(value: unknown, field: string): number | null | undefined {
  if (typeof value === 'undefined' || value === null) return value as null | undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(field, 'must be a finite number when provided', 'FETCHER_LOG_INVALID_FIELD');
  }
  return value as number;
}

function ensureOptionalString(value: unknown, field: string): string | null | undefined {
  if (typeof value === 'undefined' || value === null) return value as null | undefined;
  if (typeof value !== 'string') {
    fail(field, 'must be a string when provided', 'FETCHER_LOG_INVALID_FIELD');
  }
  return value as string;
}

export function validateFetcherLogEntry(entry: unknown, label = 'fetcherLog'): FetcherLogEntry {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    fail(label, 'must be an object', 'FETCHER_LOG_INVALID_ENTRY');
  }
  const candidate = entry as Record<string, unknown>;
  ensureNonEmptyString(candidate.id, `${label}.id`, 'FETCHER_LOG_INVALID_ID');
  ensureTimestamp(candidate.timestamp, `${label}.timestamp`);
  ensureLevel(candidate.level, `${label}.level`);
  ensureProvider(candidate.provider ?? null, `${label}.provider`);
  ensureNonEmptyString(candidate.accountId, `${label}.accountId`, 'FETCHER_LOG_INVALID_ACCOUNT');
  ensureNonEmptyString(candidate.event, `${label}.event`, 'FETCHER_LOG_INVALID_EVENT');
  ensureStringOrNull(candidate.emailId, `${label}.emailId`);
  ensureOptionalNumber(candidate.count, `${label}.count`);
  ensureOptionalString(candidate.message, `${label}.message`);
  ensureOptionalString(candidate.runId, `${label}.runId`);
  ensureOptionalString(candidate.directorId, `${label}.directorId`);
  ensureOptionalString(candidate.threadId, `${label}.threadId`);
  return candidate as FetcherLogEntry;
}

export function validateFetcherLogEntries(entries: unknown, label = 'fetcherLog'): FetcherLogEntry[] {
  if (!Array.isArray(entries)) {
    fail(label, 'must be an array of entries', 'FETCHER_LOG_INVALID_ARRAY');
  }
  return entries.map((entry, index) => validateFetcherLogEntry(entry, `${label}[${index}]`));
}
