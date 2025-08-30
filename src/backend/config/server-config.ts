import express from 'express';
import cors from 'cors';
import { globalErrorHandler, notFoundHandler } from '../middleware/error-handler';

/**
 * Configure Express application with security headers and middleware.
 */
export function configureApp(): express.Express {
  const app = express();

  // Security headers
  app.use((req, res, next) => {
    void req; // satisfy noUnusedParameters
    res.setHeader('Content-Security-Policy', "script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; object-src 'none'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  
  // CORS configuration
  const origin = (process.env.CORS_ORIGIN || '*');
  if (origin && origin !== '*') {
    app.use(cors({ origin, credentials: true }));
  } else {
    app.use(cors());
  }

  // Body parsing
  app.use(express.json());

  // Request logging
  app.use((req, res, next) => { 
    void res; 
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`); 
    next(); 
  });

  // Production security
  if ((process.env.NODE_ENV || 'development') === 'production') {
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

  // Error handling middleware (must be last)
  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  return app;
}
