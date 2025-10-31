import express from 'express';
import cors from 'cors';

import { CORS_ORIGIN, isProd } from '../config';
import logger from '../services/logger';

/** Security headers applied to all responses. */
export function configureSecurityHeaders(app: express.Application): void {
  app.use((req, res, next) => {
    void req; // satisfy noUnusedParameters
    // Strict CSP for API responses: no scripts/styles/images. Prevent framing and base-uri.
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
}

/** CORS configuration honoring CORS_ORIGIN and credentials. */
export function configureCors(app: express.Application): void {
  const origin = CORS_ORIGIN;
  if (origin && origin !== '*') {
    app.use(cors({ origin, credentials: true }));
    return;
  }

  if (isProd) {
    const message = 'CORS_ORIGIN must be set to a concrete origin in production environments.';
    logger.error(message, { origin });
    throw new Error(message);
  }

  // Allowlisted default in development to keep DX smooth; emit a one-time WARN.
  // AGENTS: Allowlisted Defaults Only — safe, documented, dev-only.
  const devDefault = 'http://localhost:3000';
  let warned = false;
  if (!warned) {
    warned = true;
    logger.warn('CORS_ORIGIN not set or wildcard in dev; defaulting to http://localhost:3000 with credentials');
  }
  app.use(cors({ origin: devDefault, credentials: true }));
}

/** JSON parser and lightweight request logging. */
export function configureParsersAndRequestLogging(app: express.Application): void {
  app.use(express.json());
  app.use((req, res, next) => {
    const started = process.hrtime.bigint();
    let completed = false;
    // Capture trace id early for downstream consumers (AppRequest.traceId)
    const headerTrace = req.headers?.['x-trace-id'];
    const traceId = Array.isArray(headerTrace) ? headerTrace[0] : headerTrace;
    (req as any).traceId = typeof traceId === 'string' ? traceId : undefined;

    const finish = (event: 'finish' | 'close') => {
      if (completed) return;
      completed = true;
      const elapsedNs = Number(process.hrtime.bigint() - started);
      const durationMs = Math.round(elapsedNs / 1_000_000);
      const status = res.statusCode;
      const method = req.method;
      const url = req.originalUrl ?? req.url;
      const uid = (req as any)?.auth?.uid;
      // Use captured trace id (set above) for consistent logging
      const traceId = (req as any).traceId;
      const contentLength = res.getHeader('content-length');
      const logFn = status >= 500 ? logger.error : status >= 400 ? logger.warn : logger.info;
      logFn('HTTP request completed', {
        method,
        url,
        status,
        durationMs,
        uid,
        traceId,
        event,
        ...(contentLength ? { contentLength } : {}),
      });
    };
    res.on('finish', () => finish('finish'));
    res.on('close', () => finish('close'));
    next();
  });
}

/** Enforce HTTPS and set HSTS in production behind proxies. */
export function configureHttpsEnforcement(app: express.Application): void {
  if (!isProd) return;

  app.enable('trust proxy');
  app.use((req, res, next) => {
  const xfProto = String(req.headers['x-forwarded-proto'] ?? '');
    if (req.secure || xfProto === 'https') return next();
    const host = req.headers.host;
    res.redirect(301, `https://${host}${req.url}`);
  });
  app.use((req, res, next) => {
    void req;
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
}
