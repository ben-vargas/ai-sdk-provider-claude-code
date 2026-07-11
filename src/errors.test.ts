import { describe, it, expect } from 'vitest';
import {
  createAPICallError,
  createAuthenticationError,
  createTimeoutError,
  isAuthenticationError,
  isTimeoutError,
  getErrorMetadata,
  stderrTail,
} from './errors.js';
import { APICallError, LoadAPIKeyError } from '@ai-sdk/provider';

describe('stderrTail', () => {
  it('selects, orders, and trims the last five non-empty lines', () => {
    expect(stderrTail(' first \n\nsecond\u2028 third \u2029fourth\nfifth\n sixth ')).toBe(
      'second; third; fourth; fifth; sixth'
    );
  });

  it('handles single-line input', () => {
    expect(stderrTail('  one diagnostic  ')).toBe('one diagnostic');
  });

  it('strips ANSI escape sequences before remaining control characters', () => {
    expect(stderrTail('\x1b[31mred\x1b[0m\x00')).toBe('red');
    expect(stderrTail('\x1b]0;window title\x07visible')).toBe('visible');
    expect(stderrTail('\x1b]0;window title\x1b\\visible')).toBe('visible');
  });

  it('splits CRLF, CR, and LF line endings', () => {
    expect(stderrTail('one\r\ntwo\rthree\nfour')).toBe('one; two; three; four');
  });

  it('caps output at 600 code points without splitting surrogate pairs', () => {
    const result = stderrTail(`${'a'.repeat(4)}😀${'b'.repeat(598)}`);

    expect(result).toBe(`…😀${'b'.repeat(598)}`);
    expect(Array.from(result)).toHaveLength(600);
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(stderrTail(' \t\r\n ')).toBe('');
    expect(stderrTail('\x1b[31m\x1b[0m')).toBe('');
  });
});

describe('Error Creation Functions', () => {
  describe('createAPICallError', () => {
    it('should create APICallError with message and details', () => {
      const error = createAPICallError({
        message: 'Test error',
        exitCode: 1,
        stderr: 'Command failed',
        promptExcerpt: 'test prompt',
      });

      expect(error).toBeInstanceOf(APICallError);
      expect(error.message).toBe('Test error | stderr (tail): Command failed');
      expect(error.isRetryable).toBe(false);
      expect(error.data).toEqual({
        exitCode: 1,
        stderr: 'Command failed',
        promptExcerpt: 'test prompt',
        code: undefined,
      });
    });

    it('should handle optional parameters', () => {
      const error = createAPICallError({
        message: 'Minimal error',
      });

      expect(error).toBeInstanceOf(APICallError);
      expect(error.message).toBe('Minimal error');
      expect(error.requestBodyValues).toBeUndefined();
    });

    it('should set retryable flag', () => {
      const error = createAPICallError({
        message: 'Retryable error',
        isRetryable: true,
      });

      expect(error.isRetryable).toBe(true);
    });

    it('appends a visible stderr tail when stderr has content', () => {
      const error = createAPICallError({
        message: 'CLI failed',
        stderr: 'first line\nlast line',
      });

      expect(error.message).toBe('CLI failed | stderr (tail): first line; last line');
    });

    it.each([undefined, '', ' \t\r\n '])(
      'does not append a dangling stderr marker for %j',
      (stderr) => {
        const error = createAPICallError({
          message: 'CLI failed',
          stderr,
        });

        expect(error.message).toBe('CLI failed');
        expect(error.message).not.toContain(' | stderr (tail):');
      }
    );

    it('does not append stderr twice when the marker is already present', () => {
      const error = createAPICallError({
        message: 'CLI failed | stderr (tail): existing detail',
        stderr: 'new detail',
      });

      expect(error.message).toBe('CLI failed | stderr (tail): existing detail');
    });

    it('preserves stderr verbatim in data while capping only the visible tail', () => {
      const stderr = `  original\n${'x'.repeat(700)}😀  `;
      const error = createAPICallError({
        message: 'CLI failed',
        stderr,
      });

      expect((error.data as { stderr?: string }).stderr).toBe(stderr);
      const visibleTail = error.message.split(' | stderr (tail): ')[1];
      expect(visibleTail).toBeDefined();
      expect(Array.from(visibleTail ?? '')).toHaveLength(600);
    });
  });

  describe('createAuthenticationError', () => {
    it('should create LoadAPIKeyError for authentication', () => {
      const error = createAuthenticationError({
        message: 'Auth failed',
      });

      expect(error).toBeInstanceOf(LoadAPIKeyError);
      expect(error.message).toBe('Auth failed');
      expect(getErrorMetadata(error)).toBeUndefined();
    });

    it('should expose stderr metadata for authentication errors', () => {
      const error = createAuthenticationError({
        message: 'Auth failed',
        stderr: 'Not authenticated',
      });

      expect(error).toBeInstanceOf(LoadAPIKeyError);
      expect(isAuthenticationError(error)).toBe(true);
      expect(getErrorMetadata(error)?.stderr).toBe('Not authenticated');
    });

    it('should use default message when empty', () => {
      const error = createAuthenticationError({
        message: '',
      });

      expect(error.message).toBe(
        'Authentication failed. Please ensure Claude Code SDK is properly authenticated.'
      );
    });
  });

  describe('createTimeoutError', () => {
    it('should create retryable APICallError for timeout', () => {
      const error = createTimeoutError({
        message: 'Request timed out after 2 minutes',
        timeoutMs: 120000,
        promptExcerpt: 'test prompt',
      });

      expect(error).toBeInstanceOf(APICallError);
      expect(error.message).toBe('Request timed out after 2 minutes');
      expect(error.isRetryable).toBe(true);
      expect(error.data).toMatchObject({
        code: 'TIMEOUT',
        timeoutMs: 120000,
        promptExcerpt: 'test prompt',
      });
    });

    it('should work without prompt excerpt', () => {
      const error = createTimeoutError({
        message: 'Timeout',
        timeoutMs: 60000,
      });

      expect(error.requestBodyValues).toBeUndefined();
      expect((error.data as any).timeoutMs).toBe(60000);
    });
  });
});

describe('Error Detection Functions', () => {
  describe('isAuthenticationError', () => {
    it('should detect LoadAPIKeyError', () => {
      const error = new LoadAPIKeyError({ message: 'Auth failed' });
      expect(isAuthenticationError(error)).toBe(true);
    });

    it('should detect APICallError with exit code 401', () => {
      const error = new APICallError({
        message: 'Unauthorized',
        url: 'test-url',
        requestBodyValues: {},
        isRetryable: false,
        data: { exitCode: 401 },
      });
      expect(isAuthenticationError(error)).toBe(true);
    });

    it('should return false for other errors', () => {
      expect(isAuthenticationError(new Error('Generic error'))).toBe(false);
      expect(
        isAuthenticationError(
          new APICallError({
            message: 'Not auth',
            url: 'test-url',
            requestBodyValues: {},
            isRetryable: false,
            data: { exitCode: 1 },
          })
        )
      ).toBe(false);
      expect(isAuthenticationError(null)).toBe(false);
    });
  });

  describe('isTimeoutError', () => {
    it('should detect APICallError with TIMEOUT code', () => {
      const error = new APICallError({
        message: 'Timeout',
        url: 'test-url',
        requestBodyValues: {},
        isRetryable: true,
        data: { code: 'TIMEOUT' },
      });
      expect(isTimeoutError(error)).toBe(true);
    });

    it('should return false for non-timeout errors', () => {
      expect(isTimeoutError(new Error('Not timeout'))).toBe(false);
      expect(
        isTimeoutError(
          new APICallError({
            message: 'Other error',
            url: 'test-url',
            requestBodyValues: {},
            isRetryable: false,
            data: { code: 'OTHER' },
          })
        )
      ).toBe(false);
      expect(isTimeoutError(null)).toBe(false);
    });
  });
});

describe('getErrorMetadata', () => {
  it('should extract metadata from APICallError', () => {
    const error = new APICallError({
      message: 'API call failed',
      url: 'test-url',
      requestBodyValues: {},
      isRetryable: false,
      data: {
        exitCode: 1,
        stderr: 'error output',
        code: 'ENOENT',
        custom: 'data',
      },
    });

    const metadata = getErrorMetadata(error);

    expect(metadata).toEqual({
      exitCode: 1,
      stderr: 'error output',
      code: 'ENOENT',
      custom: 'data',
    });
  });

  it('should return undefined for non-APICallError', () => {
    const regularError = new Error('Regular error');
    expect(getErrorMetadata(regularError)).toBeUndefined();

    const customError = { message: 'Custom error' };
    expect(getErrorMetadata(customError)).toBeUndefined();
  });

  it('should handle APICallError without data', () => {
    const error = new APICallError({
      message: 'API call failed',
      url: 'test-url',
      requestBodyValues: {},
      isRetryable: false,
    });

    const metadata = getErrorMetadata(error);
    expect(metadata).toBeUndefined();
  });
});
