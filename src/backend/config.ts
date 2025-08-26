import dotenv from 'dotenv';

dotenv.config();

// Centralized configuration and environment validation

// VX-only configuration (no legacy aliases)
export const VX_MAILAGENT_KEY = process.env.VX_MAILAGENT_KEY || '';
export const PORT: number = parseInt(process.env.PORT || '3001', 10);
export const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
// OAuth: Google
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
export const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || '';
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
    NODE_ENV: process.env.NODE_ENV || 'development',
  };
}

export function warnIfInsecure() {
  if (!VX_MAILAGENT_KEY || VX_MAILAGENT_KEY.length !== 64) {
    console.warn('[WARN] Encryption key missing or invalid (expect 64 hex in VX_MAILAGENT_KEY); persistence will use PLAINTEXT mode. Backend will run WITHOUT encryption.');
  }
}
