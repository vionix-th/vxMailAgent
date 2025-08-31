import pino, { Logger as PinoLogger } from 'pino';

export type LogContext = {
  traceId?: string;
  spanId?: string;
  uid?: string;
};

export type LogMeta = Record<string, any> | undefined;

function createLogger(): PinoLogger {
  const isProd = (process.env.NODE_ENV || 'development') === 'production';
  if (isProd) {
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

function merge(meta?: LogMeta, ctx?: LogContext) {
  if (!meta && !ctx) return undefined;
  return Object.assign({}, meta || {}, ctx ? { ctx } : {});
}

export const logger = {
  debug(msg: string, meta?: LogMeta, ctx?: LogContext) {
    rootLogger.debug(merge(meta, ctx), msg);
  },
  info(msg: string, meta?: LogMeta, ctx?: LogContext) {
    rootLogger.info(merge(meta, ctx), msg);
  },
  warn(msg: string, meta?: LogMeta, ctx?: LogContext) {
    rootLogger.warn(merge(meta, ctx), msg);
  },
  error(msg: string, meta?: LogMeta, ctx?: LogContext) {
    rootLogger.error(merge(meta, ctx), msg);
  },
  child(bindings: LogContext & Record<string, any>) {
    return rootLogger.child(bindings);
  },
};

export type Logger = typeof logger;
export default logger;
