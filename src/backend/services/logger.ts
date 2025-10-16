import pino, { Logger as PinoLogger } from 'pino';

export type LogContext = {
  traceId: string;
  spanId?: string;
  uid?: string;
};

export type LogMeta = Record<string, any> | undefined;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogObserverEntry {
  level: LogLevel;
  message: string;
  meta?: Record<string, any>;
  ctx?: LogContext;
}

function createLogger(): PinoLogger {
  const env = process.env.NODE_ENV || 'development';
  const isProd = env === 'production';
  const isTest = env === 'test';
  if (isProd || isTest) {
    return pino({
      level: process.env.LOG_LEVEL || 'info',
      base: { service: 'vxmailagent-backend' },
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }
  return pino({
    level: process.env.LOG_LEVEL || 'debug',
    base: { service: 'vxmailagent-backend' },
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        singleLine: false,
      },
    },
  });
}

const rootLogger = createLogger();

const logObservers: Array<(entry: LogObserverEntry) => void> = [];

function notifyObservers(level: LogLevel, message: string, meta?: Record<string, any>, ctx?: LogContext): void {
  if (!logObservers.length) return;
  const entry: LogObserverEntry = {
    level,
    message,
    ...(meta ? { meta: { ...meta } } : {}),
    ...(ctx ? { ctx: { ...ctx } } : {}),
  };
  for (const observer of logObservers.slice()) {
    try {
      observer(entry);
    } catch {
      // Ignore observer failures to avoid impacting core logging.
    }
  }
}

function ensureMeta(meta?: LogMeta): Record<string, any> | undefined {
  if (meta === undefined) return undefined;
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
    throw new Error('logger meta must be a plain object');
  }
  return meta as Record<string, any>;
}

function ensureContext(ctx?: LogContext): LogContext | undefined {
  if (!ctx) return undefined;
  if (typeof ctx.traceId !== 'string' || !ctx.traceId.trim()) {
    throw new Error('traceId is required in logger context');
  }
  return { ...ctx, traceId: ctx.traceId.trim() };
}

function buildEntryFromSafe(meta?: Record<string, any>, ctx?: LogContext): Record<string, any> | undefined {
  if (!meta && !ctx) return undefined;
  const entry: Record<string, any> = {};
  if (meta) Object.assign(entry, meta);
  if (ctx) entry.ctx = ctx;
  return Object.keys(entry).length ? entry : undefined;
}

function buildEntry(meta?: LogMeta, ctx?: LogContext): { entry: Record<string, any> | undefined; meta?: Record<string, any>; ctx?: LogContext } {
  const safeMeta = ensureMeta(meta);
  const safeCtx = ensureContext(ctx);
  return {
    entry: buildEntryFromSafe(safeMeta, safeCtx),
    meta: safeMeta,
    ctx: safeCtx,
  };
}

export const logger = {
  debug(msg: string, meta?: LogMeta, ctx?: LogContext) {
    const { entry, meta: safeMeta, ctx: safeCtx } = buildEntry(meta, ctx);
    rootLogger.debug(entry, msg);
    notifyObservers('debug', msg, safeMeta, safeCtx);
  },
  info(msg: string, meta?: LogMeta, ctx?: LogContext) {
    const { entry, meta: safeMeta, ctx: safeCtx } = buildEntry(meta, ctx);
    rootLogger.info(entry, msg);
    notifyObservers('info', msg, safeMeta, safeCtx);
  },
  warn(msg: string, meta?: LogMeta, ctx?: LogContext) {
    const { entry, meta: safeMeta, ctx: safeCtx } = buildEntry(meta, ctx);
    rootLogger.warn(entry, msg);
    notifyObservers('warn', msg, safeMeta, safeCtx);
  },
  error(msg: string, meta?: LogMeta, ctx?: LogContext) {
    const { entry, meta: safeMeta, ctx: safeCtx } = buildEntry(meta, ctx);
    rootLogger.error(entry, msg);
    notifyObservers('error', msg, safeMeta, safeCtx);
  },
  child(bindings: LogContext & Record<string, any>) {
    return rootLogger.child(bindings);
  },
};

export function addLogObserver(observer: (entry: LogObserverEntry) => void): () => void {
  if (typeof observer !== 'function') {
    throw new Error('observer must be a function');
  }
  logObservers.push(observer);
  return () => {
    const idx = logObservers.indexOf(observer);
    if (idx >= 0) {
      logObservers.splice(idx, 1);
    }
  };
}

export type Logger = typeof logger;
export default logger;
