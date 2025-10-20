import { describe, it, expect, vi } from 'vitest';
import { getLogger, createVerboseLogger } from './logger.js';
import type { Logger } from './types.js';

describe('logger', () => {
  describe('getLogger', () => {
    it('should return default logger when undefined', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logger = getLogger(undefined);

      logger.warn('test warning');

      expect(consoleSpy).toHaveBeenCalledWith('test warning');
      consoleSpy.mockRestore();
    });

    it('should support all log levels with default logger', () => {
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const logger = getLogger(undefined);

      logger.debug('test debug');
      logger.info('test info');
      logger.warn('test warning');
      logger.error('test error');

      expect(debugSpy).toHaveBeenCalledWith('test debug');
      expect(infoSpy).toHaveBeenCalledWith('test info');
      expect(warnSpy).toHaveBeenCalledWith('test warning');
      expect(errorSpy).toHaveBeenCalledWith('test error');

      debugSpy.mockRestore();
      infoSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should return noop logger when false', () => {
      const logger = getLogger(false);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      logger.debug('test debug');
      logger.info('test info');
      logger.warn('test warning');
      logger.error('test error');

      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should return custom logger when provided', () => {
      const customLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const logger = getLogger(customLogger);

      expect(logger).toBe(customLogger);

      logger.debug('custom debug');
      logger.info('custom info');
      logger.warn('custom warning');
      logger.error('custom error');

      expect(customLogger.debug).toHaveBeenCalledWith('custom debug');
      expect(customLogger.info).toHaveBeenCalledWith('custom info');
      expect(customLogger.warn).toHaveBeenCalledWith('custom warning');
      expect(customLogger.error).toHaveBeenCalledWith('custom error');
    });

    it('should handle error logging with default logger', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logger = getLogger(undefined);

      logger.error('test error');

      expect(consoleSpy).toHaveBeenCalledWith('test error');
      consoleSpy.mockRestore();
    });
  });

  describe('createVerboseLogger', () => {
    it('should allow all log levels when verbose is true', () => {
      const mockLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const logger = createVerboseLogger(mockLogger, true);

      logger.debug('test debug');
      logger.info('test info');
      logger.warn('test warning');
      logger.error('test error');

      expect(mockLogger.debug).toHaveBeenCalledWith('test debug');
      expect(mockLogger.info).toHaveBeenCalledWith('test info');
      expect(mockLogger.warn).toHaveBeenCalledWith('test warning');
      expect(mockLogger.error).toHaveBeenCalledWith('test error');
    });

    it('should suppress debug and info when verbose is false', () => {
      const mockLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const logger = createVerboseLogger(mockLogger, false);

      logger.debug('test debug');
      logger.info('test info');
      logger.warn('test warning');
      logger.error('test error');

      expect(mockLogger.debug).not.toHaveBeenCalled();
      expect(mockLogger.info).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith('test warning');
      expect(mockLogger.error).toHaveBeenCalledWith('test error');
    });

    it('should default to verbose false when not specified', () => {
      const mockLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const logger = createVerboseLogger(mockLogger);

      logger.debug('test debug');
      logger.info('test info');

      expect(mockLogger.debug).not.toHaveBeenCalled();
      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should preserve this binding for custom logger instances', () => {
      // Create a logger that relies on instance state
      class CustomLogger implements Logger {
        private prefix = '[CUSTOM]';

        debug(message: string) {
          return `${this.prefix} DEBUG: ${message}`;
        }

        info(message: string) {
          return `${this.prefix} INFO: ${message}`;
        }

        warn(message: string) {
          return `${this.prefix} WARN: ${message}`;
        }

        error(message: string) {
          return `${this.prefix} ERROR: ${message}`;
        }
      }

      const customLogger = new CustomLogger();
      const logger = createVerboseLogger(customLogger, false);

      // These should not throw and should preserve 'this' binding
      const warnResult = logger.warn('test warning');
      const errorResult = logger.error('test error');

      expect(warnResult).toBe('[CUSTOM] WARN: test warning');
      expect(errorResult).toBe('[CUSTOM] ERROR: test error');
    });
  });
});
