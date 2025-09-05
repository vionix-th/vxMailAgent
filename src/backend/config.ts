import dotenv from 'dotenv';
import { logger } from './services/logger';

dotenv.config();

// Centralized configuration and environment validation

// VX-only configuration (no legacy aliases)
export const VX_MAILAGENT_KEY = process.env.VX_MAILAGENT_KEY || '';
export const PORT: number = parseInt(process.env.PORT || '3001', 10);
export const HOST = process.env.HOST || '172.0.0.1';
export const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
// OAuth: Google
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
export const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || '';
// OAuth: Google (Login client - OIDC only)
export const GOOGLE_LOGIN_CLIENT_ID = process.env.GOOGLE_LOGIN_CLIENT_ID || '';
export const GOOGLE_LOGIN_CLIENT_SECRET = process.env.GOOGLE_LOGIN_CLIENT_SECRET || '';
export const GOOGLE_LOGIN_REDIRECT_URI = process.env.GOOGLE_LOGIN_REDIRECT_URI || '';
// OAuth: Outlook
export const OUTLOOK_CLIENT_ID = process.env.OUTLOOK_CLIENT_ID || '';
export const OUTLOOK_CLIENT_SECRET = process.env.OUTLOOK_CLIENT_SECRET || '';
export const OUTLOOK_REDIRECT_URI = process.env.OUTLOOK_REDIRECT_URI || '';

// Auth / Sessions (JWT)
export const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-jwt';
export const JWT_EXPIRES_IN_SEC = parseInt(process.env.JWT_EXPIRES_IN_SEC || '86400', 10); // 24h default

// Diagnostics / Tracing configuration
export const TRACE_VERBOSE = /^true$/i.test(process.env.TRACE_VERBOSE || '');
export const TRACE_PERSIST = process.env.TRACE_PERSIST === undefined ? true : /^true$/i.test(process.env.TRACE_PERSIST);
export const TRACE_MAX_PAYLOAD = parseInt(process.env.TRACE_MAX_PAYLOAD || '32768', 10); // 32KB default per payload
export const TRACE_MAX_SPANS = parseInt(process.env.TRACE_MAX_SPANS || '1000', 10);
export const TRACE_REDACT_FIELDS = (process.env.TRACE_REDACT_FIELDS || 'authorization,api_key,access_token,refresh_token,set-cookie,cookie').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
// Retention
export const TRACE_MAX_TRACES = parseInt(process.env.TRACE_MAX_TRACES || '1000', 10);
export const TRACE_TTL_DAYS = parseInt(process.env.TRACE_TTL_DAYS || '7', 10);

// Provider events retention (audit log)
export const PROVIDER_MAX_EVENTS = parseInt(process.env.PROVIDER_MAX_EVENTS || '5000', 10);
export const PROVIDER_TTL_DAYS = parseInt(process.env.PROVIDER_TTL_DAYS || '7', 10);

// Fetcher log retention
export const FETCHER_TTL_DAYS = parseInt(process.env.FETCHER_TTL_DAYS || '7', 10);

// Orchestration diagnostics retention
export const ORCHESTRATION_TTL_DAYS = parseInt(process.env.ORCHESTRATION_TTL_DAYS || '7', 10);

// Network and execution timeouts (ms)
// Keep conservative defaults to avoid indefinite hangs while not being too aggressive
export const OPENAI_REQUEST_TIMEOUT_MS = parseInt(process.env.OPENAI_REQUEST_TIMEOUT_MS || '30000', 10);
export const GRAPH_REQUEST_TIMEOUT_MS = parseInt(process.env.GRAPH_REQUEST_TIMEOUT_MS || '15000', 10);
export const PROVIDER_REQUEST_TIMEOUT_MS = parseInt(process.env.PROVIDER_REQUEST_TIMEOUT_MS || '30000', 10);
export const CONVERSATION_STEP_TIMEOUT_MS = parseInt(process.env.CONVERSATION_STEP_TIMEOUT_MS || '45000', 10);
export const TOOL_EXEC_TIMEOUT_MS = parseInt(process.env.TOOL_EXEC_TIMEOUT_MS || '30000', 10);

// Multi-user isolation configuration (always enabled)
export const USER_REGISTRY_TTL_MINUTES = parseInt(process.env.USER_REGISTRY_TTL_MINUTES || '60', 10);
export const USER_REGISTRY_MAX_ENTRIES = parseInt(process.env.USER_REGISTRY_MAX_ENTRIES || '1000', 10);
export const USER_MAX_FILE_SIZE_MB = parseInt(process.env.USER_MAX_FILE_SIZE_MB || '50', 10);
export const USER_MAX_CONVERSATIONS = parseInt(process.env.USER_MAX_CONVERSATIONS || '10000', 10);
export const USER_MAX_LOGS_PER_TYPE = parseInt(process.env.USER_MAX_LOGS_PER_TYPE || '10000', 10);
export const FETCHER_MANAGER_TTL_MINUTES = parseInt(process.env.FETCHER_MANAGER_TTL_MINUTES || '60', 10);
export const FETCHER_MANAGER_MAX_FETCHERS = parseInt(process.env.FETCHER_MANAGER_MAX_FETCHERS || '100', 10);
// Bootstrap concurrency for starting user fetchers on server startup
export const FETCHER_BOOTSTRAP_CONCURRENCY = parseInt(process.env.FETCHER_BOOTSTRAP_CONCURRENCY || '10', 10);

export function envSummary() {
  return {
    VX_MAILAGENT_KEY_PRESENT: VX_MAILAGENT_KEY.length === 64,
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
      TRACE_MAX_TRACES,
      TRACE_TTL_DAYS,
      TRACE_REDACT_FIELDS_COUNT: TRACE_REDACT_FIELDS.length,
    },
    PROVIDER_EVENTS: {
      PROVIDER_MAX_EVENTS,
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
    NODE_ENV: process.env.NODE_ENV || 'development',
  };
}

export function warnIfInsecure() {
  if (!VX_MAILAGENT_KEY || VX_MAILAGENT_KEY.length !== 64) {
    logger.warn('Encryption key missing or invalid; persistence will use PLAINTEXT mode. Backend will run WITHOUT encryption.', {
      hint: 'Expect 64 hex in VX_MAILAGENT_KEY',
      envVar: 'VX_MAILAGENT_KEY',
    });
  }
}
