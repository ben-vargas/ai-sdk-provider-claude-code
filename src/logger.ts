import type { Logger } from './types.js';

/**
 * Default logger that uses console.
 */
const defaultLogger: Logger = {
  warn: (message: string) => console.warn(message),
  error: (message: string) => console.error(message),
};

/**
 * No-op logger that discards all messages.
 */
const noopLogger: Logger = {
  warn: () => {},
  error: () => {},
};

/**
 * Gets the appropriate logger based on configuration.
 *
 * @param logger - Logger configuration from settings
 * @returns The logger to use
 */
export function getLogger(logger: Logger | false | undefined): Logger {
  if (logger === false) {
    return noopLogger;
  }

  if (logger === undefined) {
    return defaultLogger;
  }

  return logger;
}
