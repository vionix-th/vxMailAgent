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
  if (origin && origin !== '*') app.use(cors({ origin, credentials: true }));
  else app.use(cors());
}

/** JSON parser and lightweight request logging. */
export function configureParsersAndRequestLogging(app: express.Application): void {
  app.use(express.json());
  app.use((req, res, next) => {
    void res;
    logger.info('HTTP request', { method: req.method, url: req.url });
    next();
  });
}

/** Enforce HTTPS and set HSTS in production behind proxies. */
export function configureHttpsEnforcement(app: express.Application): void {
  if (!isProd) return;

  app.enable('trust proxy');
  app.use((req, res, next) => {
    const xfProto = String(req.headers['x-forwarded-proto'] || '');
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
