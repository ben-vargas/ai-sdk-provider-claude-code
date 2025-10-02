import { describe, it, expect, vi } from 'vitest';
import { getLogger } from './logger.js';
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

    it('should return noop logger when false', () => {
      const logger = getLogger(false);
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      logger.warn('test warning');
      logger.error('test error');

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should return custom logger when provided', () => {
      const customLogger: Logger = {
        warn: vi.fn(),
        error: vi.fn(),
      };

      const logger = getLogger(customLogger);

      expect(logger).toBe(customLogger);

      logger.warn('custom warning');
      logger.error('custom error');

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
});
