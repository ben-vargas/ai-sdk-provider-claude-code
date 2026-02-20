import { APICallError, LoadAPIKeyError } from '@ai-sdk/provider';

/**
 * Metadata associated with Claude Code SDK errors.
 * Provides additional context about command execution failures.
 */
export interface ClaudeCodeErrorMetadata {
  /**
   * Error code from the CLI process (e.g., 'ENOENT', 'ETIMEDOUT').
   */
  code?: string;

  /**
   * Exit code from the Claude Code SDK process.
   * Common codes:
   * - 401: Authentication error
   * - 1: General error
   */
  exitCode?: number;

  /**
   * Standard error output from the CLI process.
   */
  stderr?: string;

  /**
   * Excerpt from the prompt that caused the error.
   * Limited to first 200 characters for debugging.
   */
  promptExcerpt?: string;
}

/**
 * Creates an APICallError with Claude Code specific metadata.
 * Used for general CLI execution errors.
 *
 * @param options - Error details and metadata
 * @param options.message - Human-readable error message
 * @param options.code - Error code from the CLI process
 * @param options.exitCode - Exit code from the CLI
 * @param options.stderr - Standard error output
 * @param options.promptExcerpt - Excerpt of the prompt that caused the error
 * @param options.isRetryable - Whether the error is potentially retryable
 * @returns An APICallError instance with Claude Code metadata
 *
 * @example
 * ```typescript
 * throw createAPICallError({
 *   message: 'Claude Code SDK failed',
 *   code: 'ENOENT',
 *   isRetryable: true
 * });
 * ```
 */
export function createAPICallError({
  message,
  code,
  exitCode,
  stderr,
  promptExcerpt,
  isRetryable = false,
}: ClaudeCodeErrorMetadata & {
  message: string;
  isRetryable?: boolean;
}): APICallError {
  const metadata: ClaudeCodeErrorMetadata = {
    code,
    exitCode,
    stderr,
    promptExcerpt,
  };

  return new APICallError({
    message,
    isRetryable,
    url: 'claude-code-cli://command',
    requestBodyValues: promptExcerpt ? { prompt: promptExcerpt } : undefined,
    data: metadata,
  });
}

/**
 * Creates an authentication error for Claude Code SDK login failures.
 *
 * @param options - Error configuration
 * @param options.message - Error message describing the authentication failure
 * @returns A LoadAPIKeyError instance
 *
 * @example
 * ```typescript
 * throw createAuthenticationError({
 *   message: 'Please run "claude auth login" to authenticate'
 * });
 * ```
 */
export function createAuthenticationError({ message }: { message: string }): LoadAPIKeyError {
  return new LoadAPIKeyError({
    message:
      message || 'Authentication failed. Please ensure Claude Code SDK is properly authenticated.',
  });
}

/**
 * Creates a timeout error for Claude Code SDK operations.
 *
 * @param options - Timeout error details
 * @param options.message - Error message describing the timeout
 * @param options.promptExcerpt - Excerpt of the prompt that timed out
 * @param options.timeoutMs - Timeout duration in milliseconds
 * @returns An APICallError instance configured as a timeout error
 *
 * @example
 * ```typescript
 * throw createTimeoutError({
 *   message: 'Request timed out after 2 minutes',
 *   timeoutMs: 120000
 * });
 * ```
 */
export function createTimeoutError({
  message,
  promptExcerpt,
  timeoutMs,
}: {
  message: string;
  promptExcerpt?: string;
  timeoutMs?: number;
}): APICallError {
  // Store timeoutMs in metadata for potential use by error handlers
  const metadata: ClaudeCodeErrorMetadata = {
    code: 'TIMEOUT',
    promptExcerpt,
  };

  return new APICallError({
    message,
    isRetryable: true,
    url: 'claude-code-cli://command',
    requestBodyValues: promptExcerpt ? { prompt: promptExcerpt } : undefined,
    data: timeoutMs !== undefined ? { ...metadata, timeoutMs } : metadata,
  });
}

/**
 * Checks if an error is an authentication error.
 * Returns true for LoadAPIKeyError instances or APICallError with exit code 401.
 *
 * @param error - The error to check
 * @returns True if the error is an authentication error
 *
 * @example
 * ```typescript
 * try {
 *   await model.generate(...);
 * } catch (error) {
 *   if (isAuthenticationError(error)) {
 *     console.log('Please authenticate with Claude Code SDK');
 *   }
 * }
 * ```
 */
export function isAuthenticationError(error: unknown): boolean {
  if (error instanceof LoadAPIKeyError) return true;
  if (error instanceof APICallError && (error.data as ClaudeCodeErrorMetadata)?.exitCode === 401)
    return true;
  return false;
}

/**
 * Checks if an error is a timeout error.
 * Returns true for APICallError instances with code 'TIMEOUT'.
 *
 * @param error - The error to check
 * @returns True if the error is a timeout error
 *
 * @example
 * ```typescript
 * try {
 *   await model.generate(...);
 * } catch (error) {
 *   if (isTimeoutError(error)) {
 *     console.log('Request timed out, consider retrying');
 *   }
 * }
 * ```
 */
export function isTimeoutError(error: unknown): boolean {
  if (error instanceof APICallError && (error.data as ClaudeCodeErrorMetadata)?.code === 'TIMEOUT')
    return true;
  return false;
}

/**
 * Extracts Claude Code error metadata from an error object.
 *
 * @param error - The error to extract metadata from
 * @returns The error metadata if available, undefined otherwise
 *
 * @example
 * ```typescript
 * try {
 *   await model.generate(...);
 * } catch (error) {
 *   const metadata = getErrorMetadata(error);
 *   if (metadata?.exitCode === 401) {
 *     console.log('Authentication required');
 *   }
 * }
 * ```
 */
export function getErrorMetadata(error: unknown): ClaudeCodeErrorMetadata | undefined {
  if (error instanceof APICallError && error.data) {
    return error.data as ClaudeCodeErrorMetadata;
  }
  return undefined;
}
