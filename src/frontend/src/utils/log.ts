// Simple frontend logger utility
// - debug/info/warn/error methods
// - No-ops in production; passes through to console in development

export type LogMeta = Record<string, any> | undefined;

const isDev = (import.meta as any)?.env?.DEV === true;
const prefix = '[vxMailAgent]';

function out(level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: LogMeta) {
  if (!isDev) return;
  try {
    const args: any[] = [prefix, msg];
    if (meta && Object.keys(meta).length) args.push(meta);
    switch (level) {
      case 'debug':
        // eslint-disable-next-line no-console
        console.debug(...args);
        break;
      case 'info':
        // eslint-disable-next-line no-console
        console.info(...args);
        break;
      case 'warn':
        // eslint-disable-next-line no-console
        console.warn(...args);
        break;
      case 'error':
        // eslint-disable-next-line no-console
        console.error(...args);
        break;
    }
  } catch {
    // ignore
  }
}

export const log = {
  debug(msg: string, meta?: LogMeta) { out('debug', msg, meta); },
  info(msg: string, meta?: LogMeta) { out('info', msg, meta); },
  warn(msg: string, meta?: LogMeta) { out('warn', msg, meta); },
  error(msg: string, meta?: LogMeta) { out('error', msg, meta); },
};

export default log;
