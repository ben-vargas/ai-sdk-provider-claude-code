import { APICallError, LoadAPIKeyError } from '@ai-sdk/provider';

export const STDERR_TAIL_MARKER = ' | stderr (tail):';
const ANSI_ESCAPE_SEQUENCE =
  // eslint-disable-next-line no-control-regex
  /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~])/g;

/**
 * Converts stderr into a short, single-line tail suitable for error messages.
 */
export function stderrTail(raw: string): string {
  const withoutAnsi = raw.replace(ANSI_ESCAPE_SEQUENCE, '');
  const withoutControlCharacters = Array.from(withoutAnsi)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        character === '\r' ||
        character === '\n' ||
        codePoint === 0x2028 ||
        codePoint === 0x2029 ||
        (codePoint >= 0x20 && codePoint < 0x7f) ||
        codePoint > 0x9f
      );
    })
    .join('');
  const tail = withoutControlCharacters
    .split(/\r\n|\r|\n|\u2028|\u2029/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-5)
    .join('; ');
  const codePoints = Array.from(tail);

  return codePoints.length > 600 ? `…${codePoints.slice(-599).join('')}` : tail;
}

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
   * Structured assistant error kind reported by the Claude Agent SDK
   * (`SDKAssistantMessageError`), e.g. 'account_on_hold', 'billing_error',
   * 'overloaded', 'rate_limit', 'model_not_found', 'authentication_failed'.
   *
   * Holds a defined value only when the SDK delivered the kind structurally
   * on the failing assistant message; errors classified purely from
   * message/stderr text, process state, or exit codes read as `undefined`
   * (the property may exist with an `undefined` value, like the other
   * fields in this metadata envelope — check the value, not key presence).
   * Typed as `string` (not the SDK union) so new SDK kinds flow through
   * without a type-level break; treat unrecognized values as a generic
   * failure.
   */
  errorKind?: string;

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
 * @param options.errorKind - Structured SDK assistant error kind, when reported
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
  errorKind,
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
    errorKind,
    exitCode,
    stderr,
    promptExcerpt,
  };
  const tail = typeof stderr === 'string' && stderr.length > 0 ? stderrTail(stderr) : '';
  const enrichedMessage =
    tail && !message.includes(STDERR_TAIL_MARKER)
      ? `${message}${STDERR_TAIL_MARKER} ${tail}`
      : message;

  return new APICallError({
    message: enrichedMessage,
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
 * @param options.errorKind - Structured SDK assistant error kind, when reported
 * @returns A LoadAPIKeyError instance
 *
 * @example
 * ```typescript
 * throw createAuthenticationError({
 *   message: 'Please run "claude auth login" to authenticate'
 * });
 * ```
 */
export function createAuthenticationError({
  message,
  stderr,
  errorKind,
}: {
  message: string;
  stderr?: string;
  errorKind?: string;
}): LoadAPIKeyError {
  const error = new LoadAPIKeyError({
    message:
      message || 'Authentication failed. Please ensure Claude Code SDK is properly authenticated.',
  });
  if (stderr || errorKind !== undefined) {
    (error as LoadAPIKeyError & { data?: ClaudeCodeErrorMetadata }).data = {
      ...(stderr && { stderr }),
      ...(errorKind !== undefined && { errorKind }),
    };
  }
  return error;
}

/**
 * Creates a timeout error for Claude Code SDK operations.
 *
 * @param options - Timeout error details
 * @param options.message - Error message describing the timeout
 * @param options.promptExcerpt - Excerpt of the prompt that timed out
 * @param options.timeoutMs - Timeout duration in milliseconds
 * @param options.errorKind - Structured SDK assistant error kind, when reported
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
  stderr,
  promptExcerpt,
  timeoutMs,
  errorKind,
}: {
  message: string;
  stderr?: string;
  promptExcerpt?: string;
  timeoutMs?: number;
  errorKind?: string;
}): APICallError {
  // Store timeoutMs in metadata for potential use by error handlers
  const metadata: ClaudeCodeErrorMetadata = {
    code: 'TIMEOUT',
    errorKind,
    stderr,
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
 * Account-state errors (structured kind 'account_on_hold' or 'billing_error')
 * always return false, even when the metadata carries exit code 401: the exit
 * code is preserved as a diagnostic, but the structured account-state kind
 * vetoes authentication classification — re-authenticating cannot resolve
 * those errors. Use {@link isAccountStateError} to detect them.
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
  if (isAccountStateError(error)) return false;
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
 * Checks if an error is an account-state error (billing hold or billing
 * failure on the Anthropic account). These are not credential problems:
 * re-authenticating will not resolve them — the account must be fixed in
 * the Anthropic Console (https://console.anthropic.com).
 *
 * Returns true exactly when the provider classified the error as
 * account-state, which happens if and only if the metadata carries the
 * structured SDK error kind 'account_on_hold' or 'billing_error' on an
 * APICallError. Message text and stderr are intentionally not inspected.
 *
 * @param error - The error to check
 * @returns True if the error is an account-state error
 *
 * @example
 * ```typescript
 * try {
 *   await model.generate(...);
 * } catch (error) {
 *   if (isAccountStateError(error)) {
 *     console.log('Resolve the billing issue or hold in the Anthropic Console');
 *   }
 * }
 * ```
 */
export function isAccountStateError(error: unknown): boolean {
  if (!(error instanceof APICallError)) return false;
  const kind = (error.data as ClaudeCodeErrorMetadata | undefined)?.errorKind;
  return kind === 'account_on_hold' || kind === 'billing_error';
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
  if (error instanceof LoadAPIKeyError && (error as LoadAPIKeyError & { data?: unknown }).data) {
    return (error as LoadAPIKeyError & { data?: ClaudeCodeErrorMetadata }).data;
  }
  return undefined;
}
