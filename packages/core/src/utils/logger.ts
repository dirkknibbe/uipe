export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info';

function log(level: LogLevel, component: string, message: string, data?: unknown): void {
  if (LEVELS[level] < LEVELS[currentLevel]) return;
  const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${component}]`;
  if (data !== undefined) {
    console.log(prefix, message, data);
  } else {
    console.log(prefix, message);
  }
}

export function createLogger(component: string) {
  return {
    debug: (msg: string, data?: unknown) => log('debug', component, msg, data),
    info: (msg: string, data?: unknown) => log('info', component, msg, data),
    warn: (msg: string, data?: unknown) => log('warn', component, msg, data),
    error: (msg: string, data?: unknown) => log('error', component, msg, data),
  };
}
