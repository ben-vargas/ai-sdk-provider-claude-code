import type { Logger } from './types.js';

/**
 * Default logger that uses console.
 */
const defaultLogger: Logger = {
  debug: (message: string) => console.debug(message),
  info: (message: string) => console.info(message),
  warn: (message: string) => console.warn(message),
  error: (message: string) => console.error(message),
};

/**
 * No-op logger that discards all messages.
 */
const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
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

/**
 * Creates a verbose-aware logger that only logs debug/info when verbose is enabled.
 * Warn and error are always logged regardless of verbose setting.
 *
 * @param logger - Base logger to wrap
 * @param verbose - Whether to enable verbose (debug/info) logging
 * @returns Logger with verbose-aware behavior
 */
export function createVerboseLogger(logger: Logger, verbose: boolean = false): Logger {
  if (verbose) {
    // When verbose is enabled, use all log levels
    return logger;
  }

  // When verbose is disabled, only allow warn/error
  // Wrap methods to preserve 'this' binding for custom loggers
  return {
    debug: () => {}, // No-op when not verbose
    info: () => {}, // No-op when not verbose
    warn: (msg) => logger.warn(msg),
    error: (msg) => logger.error(msg),
  };
}
