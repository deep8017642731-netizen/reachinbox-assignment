/**
 * Minimal structured logger.
 *
 * Requirements it satisfies:
 *  - Human-readable in development:  `2026-09-19T12:00:00.000Z [Worker] Email abc123 sent`
 *  - Machine-readable extra context: a JSON object appended after the message.
 *  - A scope per module so you can `grep "\[Worker\]"` during the demo.
 *
 * Deliberately dependency-free: `console.log` is already non-blocking enough for
 * this workload (one line per email), and a logging library would be one more
 * thing to explain in an interview for no benefit here.
 */
import { env } from '../config/env';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogFields {
  [key: string]: unknown;
}

function write(level: LogLevel, scope: string, message: string, fields?: LogFields): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[env.LOG_LEVEL]) return;

  const timestamp = new Date().toISOString();
  let line = `${timestamp} [${scope}] ${message}`;

  if (fields && Object.keys(fields).length > 0) {
    line += ` ${serialise(fields)}`;
  }

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/**
 * JSON.stringify throws on circular structures, and Error objects serialise to
 * `{}`. Neither should ever crash a worker because of a log statement.
 */
function serialise(fields: LogFields): string {
  try {
    return JSON.stringify(fields, (_key, value) => {
      if (value instanceof Error) {
        return { name: value.name, message: value.message, stack: value.stack };
      }
      return value;
    });
  } catch {
    return '{"logSerialisationError":true}';
  }
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

/** Creates a logger bound to a scope, e.g. createLogger('Worker'). */
export function createLogger(scope: string): Logger {
  return {
    debug: (message, fields) => write('debug', scope, message, fields),
    info: (message, fields) => write('info', scope, message, fields),
    warn: (message, fields) => write('warn', scope, message, fields),
    error: (message, fields) => write('error', scope, message, fields),
  };
}
