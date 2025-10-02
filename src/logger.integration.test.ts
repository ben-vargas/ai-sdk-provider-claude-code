import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createClaudeCode } from '../src/index.js';
import type { Logger } from '../src/types.js';

describe('logger integration', () => {
  let originalConsoleWarn: typeof console.warn;
  let originalConsoleError: typeof console.error;
  let consoleWarnSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    originalConsoleWarn = console.warn;
    originalConsoleError = console.error;
    consoleWarnSpy = vi.fn();
    consoleErrorSpy = vi.fn();
    console.warn = consoleWarnSpy;
    console.error = consoleErrorSpy;
  });

  afterEach(() => {
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  });

  describe('createClaudeCode with logger settings', () => {
    it('should use console logger by default', () => {
      createClaudeCode({
        defaultSettings: {
          maxTurns: 99, // High value to trigger warning
        },
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('High maxTurns value'));
    });

    it('should respect logger: false setting', () => {
      createClaudeCode({
        defaultSettings: {
          logger: false,
          maxTurns: 99, // High value that would normally trigger warning
        },
      });

      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should use custom logger when provided', () => {
      const customLogger: Logger = {
        warn: vi.fn(),
        error: vi.fn(),
      };

      createClaudeCode({
        defaultSettings: {
          logger: customLogger,
          maxTurns: 99, // High value to trigger warning
        },
      });

      expect(customLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('High maxTurns value')
      );
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should pass logger to created models', () => {
      const customLogger: Logger = {
        warn: vi.fn(),
        error: vi.fn(),
      };

      const provider = createClaudeCode({
        defaultSettings: {
          logger: customLogger,
        },
      });

      // Create a model with an unknown ID to trigger warning
      provider('unknown-model-id');

      expect(customLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Unknown model ID'));
    });

    it('should allow model-specific logger override', () => {
      const providerLogger: Logger = {
        warn: vi.fn(),
        error: vi.fn(),
      };

      const modelLogger: Logger = {
        warn: vi.fn(),
        error: vi.fn(),
      };

      const provider = createClaudeCode({
        defaultSettings: {
          logger: providerLogger,
        },
      });

      // Create a model with its own logger
      provider('unknown-model', {
        logger: modelLogger,
      });

      expect(modelLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Unknown model ID'));
      expect(providerLogger.warn).not.toHaveBeenCalled();
    });

    it('should handle image input warnings', async () => {
      const customLogger: Logger = {
        warn: vi.fn(),
        error: vi.fn(),
      };

      const provider = createClaudeCode({
        defaultSettings: {
          logger: customLogger,
        },
      });

      provider('opus');

      // Mock the query function to prevent actual API calls
      const { ClaudeCodeLanguageModel } = await import('../src/claude-code-language-model.js');
      const proto = ClaudeCodeLanguageModel.prototype as any;

      // Access the private method through prototype
      const result = proto.generateAllWarnings.call(
        {
          modelValidationWarning: undefined,
          settingsValidationWarnings: [],
          logger: customLogger,
        },
        {
          prompt: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Hello' },
                { type: 'image', image: new Uint8Array([]) },
              ],
            },
          ],
        },
        'test prompt'
      );

      // The warning should be in the warnings array, not logged directly
      expect(customLogger.warn).not.toHaveBeenCalled();
      expect(result.some((w: any) => w.message?.includes('image inputs'))).toBe(false);
    });
  });
});
