import pino, { Logger as PinoLogger } from 'pino';

export type LogContext = {
  traceId: string;
  spanId?: string;
  uid?: string;
};

export type LogMeta = Record<string, any> | undefined;

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

function buildEntry(meta?: LogMeta, ctx?: LogContext): Record<string, any> | undefined {
  const safeMeta = ensureMeta(meta);
  const safeCtx = ensureContext(ctx);
  if (!safeMeta && !safeCtx) return undefined;
  const entry: Record<string, any> = {};
  if (safeMeta) Object.assign(entry, safeMeta);
  if (safeCtx) entry.ctx = safeCtx;
  return Object.keys(entry).length ? entry : undefined;
}

export const logger = {
  debug(msg: string, meta?: LogMeta, ctx?: LogContext) {
    rootLogger.debug(buildEntry(meta, ctx), msg);
  },
  info(msg: string, meta?: LogMeta, ctx?: LogContext) {
    rootLogger.info(buildEntry(meta, ctx), msg);
  },
  warn(msg: string, meta?: LogMeta, ctx?: LogContext) {
    rootLogger.warn(buildEntry(meta, ctx), msg);
  },
  error(msg: string, meta?: LogMeta, ctx?: LogContext) {
    rootLogger.error(buildEntry(meta, ctx), msg);
  },
  child(bindings: LogContext & Record<string, any>) {
    return rootLogger.child(bindings);
  },
};

export type Logger = typeof logger;
export default logger;
