import type { APICallError, LoadAPIKeyError } from '@ai-sdk/provider';
import { createAPICallError, createAuthenticationError, createTimeoutError } from './errors.js';

interface ErrorWithMessage {
  message?: string;
}

interface ErrorWithCode {
  code?: string;
  exitCode?: number;
  stderr?: string;
}

export class ErrorHandler {
  private static readonly AUTH_ERROR_PATTERNS = [
    'not logged in',
    'authentication',
    'unauthorized',
    'auth failed',
    'please login',
    'claude login',
  ];

  static isAbortError(err: unknown): boolean {
    if (err && typeof err === 'object') {
      const e = err as { name?: unknown; code?: unknown };
      if (typeof e.name === 'string' && e.name === 'AbortError') return true;
      if (typeof e.code === 'string' && e.code.toUpperCase() === 'ABORT_ERR') return true;
    }
    return false;
  }

  static isClaudeCodeTruncationError(error: unknown, bufferedText: string): boolean {
    const MIN_TRUNCATION_LENGTH = 512;

    const errorObj = error as { name?: unknown; message?: unknown };
    const isSyntaxError =
      error instanceof SyntaxError ||
      (typeof errorObj.name === 'string' && errorObj.name.toLowerCase() === 'syntaxerror');

    if (!isSyntaxError || !bufferedText) {
      return false;
    }

    const rawMessage = typeof errorObj.message === 'string' ? errorObj.message : '';
    const message = rawMessage.toLowerCase();

    const truncationIndicators = [
      'unexpected end of json input',
      'unexpected end of input',
      'unexpected end of string',
      'unexpected eof',
      'end of file',
      'unterminated string',
      'unterminated string constant',
    ];

    if (!truncationIndicators.some((indicator) => message.includes(indicator))) {
      return false;
    }

    if (bufferedText.length < MIN_TRUNCATION_LENGTH) {
      return false;
    }

    return true;
  }

  static handleClaudeCodeError(
    error: unknown,
    messagesPrompt: string
  ): APICallError | LoadAPIKeyError {
    if (ErrorHandler.isAbortError(error)) {
      throw error;
    }

    const isErrorWithMessage = (err: unknown): err is ErrorWithMessage => {
      return typeof err === 'object' && err !== null && 'message' in err;
    };

    const isErrorWithCode = (err: unknown): err is ErrorWithCode => {
      return typeof err === 'object' && err !== null;
    };

    const errorMessage = isErrorWithMessage(error) && error.message ? error.message.toLowerCase() : '';
    const exitCode = isErrorWithCode(error) && typeof error.exitCode === 'number' ? error.exitCode : undefined;
    const errorCode = isErrorWithCode(error) && typeof error.code === 'string' ? error.code : '';

    if (ErrorHandler.isAuthenticationError(errorMessage, exitCode)) {
      return createAuthenticationError({
        message:
          isErrorWithMessage(error) && error.message
            ? error.message
            : 'Authentication failed. Please ensure Claude Code SDK is properly authenticated.',
      });
    }

    if (ErrorHandler.isTimeoutError(errorCode, errorMessage)) {
      return createTimeoutError({
        message: isErrorWithMessage(error) && error.message ? error.message : 'Request timed out',
        promptExcerpt: messagesPrompt.substring(0, 200),
      });
    }

    const isRetryable = ErrorHandler.isRetryableError(errorCode);

    return createAPICallError({
      message: isErrorWithMessage(error) && error.message ? error.message : 'Claude Code SDK error',
      code: errorCode || undefined,
      exitCode: exitCode,
      stderr: isErrorWithCode(error) && typeof error.stderr === 'string' ? error.stderr : undefined,
      promptExcerpt: messagesPrompt.substring(0, 200),
      isRetryable,
    });
  }

  private static isAuthenticationError(errorMessage: string, exitCode?: number): boolean {
    return (
      ErrorHandler.AUTH_ERROR_PATTERNS.some((pattern) => errorMessage.includes(pattern)) ||
      exitCode === 401
    );
  }

  private static isTimeoutError(errorCode: string, errorMessage: string): boolean {
    return errorCode === 'ETIMEDOUT' || errorMessage.includes('timeout');
  }

  private static isRetryableError(errorCode: string): boolean {
    const retryableCodes = ['ENOENT', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'];
    return retryableCodes.includes(errorCode);
  }
}
