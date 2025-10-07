import dotenv from 'dotenv';
import logger from './services/logger';

// Allow disabling dotenv in test environments to avoid .env interference
if (String(process.env.DISABLE_DOTENV ?? '').toLowerCase() !== 'true') {
  dotenv.config();
}

// Centralized configuration and environment validation

function requireEnv(key: string): string {
  const raw = process.env[key];
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return raw;
}

function requireIntEnv(key: string): number {
  const value = requireEnv(key);
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer for environment variable ${key}`);
  }
  return parsed;
}

function getOptionalEnv(key: string, fallback: string): string {
  const raw = process.env[key];
  if (typeof raw === 'string' && raw.trim() !== '') return raw;
  return fallback;
}

function getOptionalIntEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid integer for environment variable ${key}`);
    }
    return parsed;
  }
  return fallback;
}

// VX-only configuration
export const PORT: number = getOptionalIntEnv('PORT', 3001);
export const HOST = getOptionalEnv('HOST', '0.0.0.0');
export const CORS_ORIGIN = getOptionalEnv('CORS_ORIGIN', '*');
export const isProd = getOptionalEnv('NODE_ENV', 'development') === 'production';
// Feature flags
export const ENABLE_TEST_ROUTES = /^true$/i.test(getOptionalEnv('ENABLE_TEST_ROUTES', ''));

// OAuth: Google - allow empty for optional configuration
export const GOOGLE_CLIENT_ID = requireEnv('GOOGLE_CLIENT_ID');
export const GOOGLE_CLIENT_SECRET = requireEnv('GOOGLE_CLIENT_SECRET');
export const GOOGLE_REDIRECT_URI = requireEnv('GOOGLE_REDIRECT_URI');

// OAuth: Google (Login client - OIDC only)
export const GOOGLE_LOGIN_CLIENT_ID = getOptionalEnv('GOOGLE_LOGIN_CLIENT_ID', '');
export const GOOGLE_LOGIN_CLIENT_SECRET = getOptionalEnv('GOOGLE_LOGIN_CLIENT_SECRET', '');
export const GOOGLE_LOGIN_REDIRECT_URI = getOptionalEnv('GOOGLE_LOGIN_REDIRECT_URI', '');

// OAuth: Outlook
export const OUTLOOK_CLIENT_ID = requireEnv('OUTLOOK_CLIENT_ID');
export const OUTLOOK_CLIENT_SECRET = requireEnv('OUTLOOK_CLIENT_SECRET');
export const OUTLOOK_REDIRECT_URI = requireEnv('OUTLOOK_REDIRECT_URI');

// Auth / Sessions (JWT)
export const JWT_SECRET = requireEnv('JWT_SECRET');
export const JWT_EXPIRES_IN_SEC = requireIntEnv('JWT_EXPIRES_IN_SEC');

// Diagnostics / Tracing configuration
export const TRACE_VERBOSE = /^true$/i.test(getOptionalEnv('TRACE_VERBOSE', ''));
export const TRACE_PERSIST = process.env.TRACE_PERSIST === undefined ? true : /^true$/i.test(process.env.TRACE_PERSIST);
export const TRACE_MAX_PAYLOAD = getOptionalIntEnv('TRACE_MAX_PAYLOAD', 32768); // 32KB default per payload
export const TRACE_MAX_SPANS = getOptionalIntEnv('TRACE_MAX_SPANS', 1000);
export const TRACE_REDACT_FIELDS = getOptionalEnv('TRACE_REDACT_FIELDS', 'authorization,api_key,access_token,refresh_token,set-cookie,cookie').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
// Retention
export const TRACE_TTL_DAYS = getOptionalIntEnv('TRACE_TTL_DAYS', 7);

// Provider events retention (audit log)
export const PROVIDER_TTL_DAYS = getOptionalIntEnv('PROVIDER_TTL_DAYS', 7);

// Fetcher log retention
export const FETCHER_TTL_DAYS = getOptionalIntEnv('FETCHER_TTL_DAYS', 7);

// Orchestration diagnostics retention
export const ORCHESTRATION_TTL_DAYS = getOptionalIntEnv('ORCHESTRATION_TTL_DAYS', 7);

// Network and execution timeouts (ms)
// Keep conservative defaults to avoid indefinite hangs while not being too aggressive
export const OPENAI_REQUEST_TIMEOUT_MS = getOptionalIntEnv('OPENAI_REQUEST_TIMEOUT_MS', 30000);
export const GRAPH_REQUEST_TIMEOUT_MS = getOptionalIntEnv('GRAPH_REQUEST_TIMEOUT_MS', 15000);
export const PROVIDER_REQUEST_TIMEOUT_MS = getOptionalIntEnv('PROVIDER_REQUEST_TIMEOUT_MS', 30000);
export const CONVERSATION_STEP_TIMEOUT_MS = getOptionalIntEnv('CONVERSATION_STEP_TIMEOUT_MS', 45000);
export const TOOL_EXEC_TIMEOUT_MS = getOptionalIntEnv('TOOL_EXEC_TIMEOUT_MS', 30000);

// Multi-user isolation configuration (always enabled)
export const USER_REGISTRY_TTL_MINUTES = getOptionalIntEnv('USER_REGISTRY_TTL_MINUTES', 60);
export const USER_REGISTRY_MAX_ENTRIES = getOptionalIntEnv('USER_REGISTRY_MAX_ENTRIES', 1000);
export const USER_MAX_FILE_SIZE_MB = getOptionalIntEnv('USER_MAX_FILE_SIZE_MB', 50);
export const USER_MAX_CONVERSATIONS = getOptionalIntEnv('USER_MAX_CONVERSATIONS', 10000);
export const USER_MAX_LOGS_PER_TYPE = getOptionalIntEnv('USER_MAX_LOGS_PER_TYPE', 10000);
export const FETCHER_MANAGER_TTL_MINUTES = getOptionalIntEnv('FETCHER_MANAGER_TTL_MINUTES', 60);
export const FETCHER_MANAGER_MAX_FETCHERS = getOptionalIntEnv('FETCHER_MANAGER_MAX_FETCHERS', 100);
// Bootstrap concurrency for starting user fetchers on server startup
export const FETCHER_BOOTSTRAP_CONCURRENCY = getOptionalIntEnv('FETCHER_BOOTSTRAP_CONCURRENCY', 10);

// ---- Validated OAuth config helpers (fail fast; avoid non-null assertions) ----
type OAuthCfg = { clientId: string; clientSecret: string; redirectUri: string };

function requireNonEmpty(val: string, key: string): string {
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

export function getGoogleOAuthConfig(): OAuthCfg {
  return {
    clientId: requireNonEmpty(GOOGLE_CLIENT_ID, 'GOOGLE_CLIENT_ID'),
    clientSecret: requireNonEmpty(GOOGLE_CLIENT_SECRET, 'GOOGLE_CLIENT_SECRET'),
    redirectUri: requireNonEmpty(GOOGLE_REDIRECT_URI, 'GOOGLE_REDIRECT_URI'),
  };
}

export function getOutlookOAuthConfig(): OAuthCfg {
  return {
    clientId: requireNonEmpty(OUTLOOK_CLIENT_ID, 'OUTLOOK_CLIENT_ID'),
    clientSecret: requireNonEmpty(OUTLOOK_CLIENT_SECRET, 'OUTLOOK_CLIENT_SECRET'),
    redirectUri: requireNonEmpty(OUTLOOK_REDIRECT_URI, 'OUTLOOK_REDIRECT_URI'),
  };
}

/**
 * Prefer dedicated Google Login client if fully configured; otherwise fallback to primary Google client.
 * Throws a clear error if neither set is fully specified.
 */
export function getGoogleLoginOAuthConfigOrPrimary(): OAuthCfg {
  const loginSetComplete = !!(GOOGLE_LOGIN_CLIENT_ID && GOOGLE_LOGIN_CLIENT_SECRET && GOOGLE_LOGIN_REDIRECT_URI);
  if (loginSetComplete) {
    return {
      clientId: requireNonEmpty(GOOGLE_LOGIN_CLIENT_ID, 'GOOGLE_LOGIN_CLIENT_ID'),
      clientSecret: requireNonEmpty(GOOGLE_LOGIN_CLIENT_SECRET, 'GOOGLE_LOGIN_CLIENT_SECRET'),
      redirectUri: requireNonEmpty(GOOGLE_LOGIN_REDIRECT_URI, 'GOOGLE_LOGIN_REDIRECT_URI'),
    };
  }
  // Fallback to primary Google OAuth client
  return getGoogleOAuthConfig();
}

export function envSummary() {
  return {
    PORT,
    CORS_ORIGIN,
    GOOGLE: {
      CLIENT_ID_PRESENT: !!GOOGLE_CLIENT_ID,
      CLIENT_SECRET_PRESENT: !!GOOGLE_CLIENT_SECRET,
      REDIRECT_URI_PRESENT: !!GOOGLE_REDIRECT_URI,
    },
    GOOGLE_LOGIN: {
      CLIENT_ID_PRESENT: !!GOOGLE_LOGIN_CLIENT_ID,
      CLIENT_SECRET_PRESENT: !!GOOGLE_LOGIN_CLIENT_SECRET,
      REDIRECT_URI_PRESENT: !!GOOGLE_LOGIN_REDIRECT_URI,
    },
    OUTLOOK: {
      CLIENT_ID_PRESENT: !!OUTLOOK_CLIENT_ID,
      CLIENT_SECRET_PRESENT: !!OUTLOOK_CLIENT_SECRET,
      REDIRECT_URI_PRESENT: !!OUTLOOK_REDIRECT_URI,
    },
    TRACING: {
      TRACE_VERBOSE,
      TRACE_PERSIST,
      TRACE_MAX_PAYLOAD,
      TRACE_MAX_SPANS,
      TRACE_TTL_DAYS,
      TRACE_REDACT_FIELDS_COUNT: TRACE_REDACT_FIELDS.length,
    },
    PROVIDER_EVENTS: {
      PROVIDER_TTL_DAYS,
    },
    ORCHESTRATION: {
      ORCHESTRATION_TTL_DAYS,
    },
    FETCHER_MANAGER: {
      FETCHER_MANAGER_TTL_MINUTES,
      FETCHER_MANAGER_MAX_FETCHERS,
      FETCHER_BOOTSTRAP_CONCURRENCY,
    },
    NODE_ENV: getOptionalEnv('NODE_ENV', 'development'),
  };
}

export function assertSecureConfig() {
  if (JWT_SECRET.length < 32) {
    const msg = 'JWT_SECRET must be at least 32 characters.';
    logger.error(msg, { envVar: 'JWT_SECRET' });
    throw new Error(msg);
  }

  if (!Number.isFinite(JWT_EXPIRES_IN_SEC) || JWT_EXPIRES_IN_SEC <= 0) {
    const msg = 'JWT_EXPIRES_IN_SEC must be a positive integer (seconds).';
    logger.error(msg, { envVar: 'JWT_EXPIRES_IN_SEC', value: JWT_EXPIRES_IN_SEC });
    throw new Error(msg);
  }
}
