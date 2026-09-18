export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  cron?: string;
  userId?: string;
  tenantId?: string;
  source?: string;
  modelId?: string;
  duration?: number;
  count?: number;
  warningCount?: number;
  errorCount?: number;
  error?: string;
  stack?: string;
  [key: string]: unknown;
}

export function log(level: LogLevel, message: string, ctx: LogContext = {}) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...ctx,
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, ctx?: LogContext) => log('debug', msg, ctx),
  info: (msg: string, ctx?: LogContext) => log('info', msg, ctx),
  warn: (msg: string, ctx?: LogContext) => log('warn', msg, ctx),
  error: (msg: string, ctx?: LogContext) => log('error', msg, ctx),
};
