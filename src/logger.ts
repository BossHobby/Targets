export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerOptions {
  level: LogLevel;
  prefix?: string;
}

export class Logger {
  private level: LogLevel;
  private prefix: string;
  private levels = {
    debug: 0,
    info: 1,  
    warn: 2,
    error: 3
  };

  constructor(options: LoggerOptions) {
    this.level = options.level;
    this.prefix = options.prefix || '';
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levels[level] >= this.levels[this.level];
  }

  private formatMessage(level: LogLevel, ...args: any[]): string {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(5);
    const prefix = this.prefix ? `[${this.prefix}] ` : '';
    return `${timestamp} ${levelStr} ${prefix}${args.join(' ')}`;
  }

  debug(...args: any[]): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', ...args));
    }
  }

  info(...args: any[]): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', ...args));
    }
  }

  warn(...args: any[]): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', ...args));
    }
  }

  error(...args: any[]): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', ...args));
    }
  }

  child(prefix: string): Logger {
    return new Logger({
      level: this.level,
      prefix: this.prefix ? `${this.prefix}:${prefix}` : prefix
    });
  }
}

export function createLogger(options: LoggerOptions): Logger {
  return new Logger(options);
}