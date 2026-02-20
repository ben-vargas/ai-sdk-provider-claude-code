import type {
  LanguageModelV3,
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
  SharedV3Warning,
  JSONValue,
  JSONObject,
} from '@ai-sdk/provider';
import { NoSuchModelError, APICallError, LoadAPIKeyError } from '@ai-sdk/provider';
import { generateId } from '@ai-sdk/provider-utils';
import type { ClaudeCodeSettings, Logger, MessageInjector } from './types.js';
import { convertToClaudeCodeMessages } from './convert-to-claude-code-messages.js';
import { createAPICallError, createAuthenticationError, createTimeoutError } from './errors.js';
import { mapClaudeCodeFinishReason } from './map-claude-code-finish-reason.js';
import { validateModelId, validatePrompt, validateSessionId } from './validation.js';
import { getLogger, createVerboseLogger } from './logger.js';

import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import type { SDKUserMessage, SDKPartialAssistantMessage } from '@anthropic-ai/claude-agent-sdk';

const CLAUDE_CODE_TRUNCATION_WARNING =
  'Claude Code SDK output ended unexpectedly; returning truncated response from buffered text. Await upstream fix to avoid data loss.';

const MIN_TRUNCATION_LENGTH = 512;

/**
 * Detects if an error represents a truncated SDK JSON stream.
 *
 * The Claude Code SDK can truncate JSON responses mid-stream, producing a SyntaxError.
 * This function distinguishes genuine truncation from normal JSON syntax errors by:
 * 1. Verifying the error is a SyntaxError with truncation-specific messages
 * 2. Ensuring we received meaningful content (>= MIN_TRUNCATION_LENGTH characters)
 * 3. Avoiding false positives from unrelated parse errors
 *
 * Note: We compare against `bufferedText` (assistant text content) rather than the raw
 * JSON buffer length, since the SDK layer doesn't expose buffer positions. The position
 * reported in SyntaxError messages measures the full JSON payload (metadata + content),
 * which is typically much larger than extracted text. Therefore, we cannot reliably use
 * position proximity checks and instead rely on message patterns and content length.
 *
 * @param error - The caught error (expected to be SyntaxError for truncation)
 * @param bufferedText - Accumulated assistant text content (measured in UTF-16 code units)
 * @returns true if error indicates SDK truncation; false otherwise
 */
function isClaudeCodeTruncationError(error: unknown, bufferedText: string): boolean {
  // Check for SyntaxError by instanceof or by name (for cross-realm errors)
  const isSyntaxError =
    error instanceof SyntaxError ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (typeof (error as any)?.name === 'string' &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (error as any).name.toLowerCase() === 'syntaxerror');

  if (!isSyntaxError) {
    return false;
  }

  if (!bufferedText) {
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawMessage = typeof (error as any)?.message === 'string' ? (error as any).message : '';
  const message = rawMessage.toLowerCase();

  // Only match actual truncation patterns, not normal JSON parsing errors.
  // Real truncation: "Unexpected end of JSON input" or "Unterminated string in JSON..."
  // Normal errors: "Unexpected token X in JSON at position N" (should be surfaced as errors)
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

  // Require meaningful content before treating as truncation.
  // Short responses with "end of input" errors are likely genuine syntax errors.
  // Note: bufferedText.length measures UTF-16 code units, not byte length.
  if (bufferedText.length < MIN_TRUNCATION_LENGTH) {
    return false;
  }

  // If we have a truncation indicator AND meaningful content, treat as truncation.
  return true;
}

function isAbortError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown; code?: unknown };
    if (typeof e.name === 'string' && e.name === 'AbortError') return true;
    if (typeof e.code === 'string' && e.code.toUpperCase() === 'ABORT_ERR') return true;
  }
  return false;
}

const DEFAULT_INHERITED_ENV_VARS =
  process.platform === 'win32'
    ? [
        'APPDATA',
        'HOMEDRIVE',
        'HOMEPATH',
        'LOCALAPPDATA',
        'PATH',
        'PATHEXT',
        'SYSTEMDRIVE',
        'SYSTEMROOT',
        'TEMP',
        'TMP',
        'USERNAME',
        'USERPROFILE',
        'WINDIR',
      ]
    : ['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'USER', 'LANG', 'LC_ALL', 'TMPDIR'];

const CLAUDE_ENV_VARS = ['CLAUDE_CONFIG_DIR'];

function getBaseProcessEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const allowedKeys = new Set([...DEFAULT_INHERITED_ENV_VARS, ...CLAUDE_ENV_VARS]);

  for (const key of allowedKeys) {
    const value = process.env[key];
    if (typeof value !== 'string') {
      continue;
    }

    if (value.startsWith('()')) {
      continue;
    }

    env[key] = value;
  }

  return env;
}

const STREAMING_FEATURE_WARNING =
  "Claude Agent SDK features (hooks/MCP/images) require streaming input. Set `streamingInput: 'always'` or provide `canUseTool` (auto streams only when canUseTool is set).";

const SDK_OPTIONS_BLOCKLIST = new Set(['model', 'abortController', 'prompt', 'outputFormat']);

type ClaudeToolUse = {
  id: string;
  name: string;
  input: unknown;
  parentToolUseId?: string | null;
};

type ClaudeToolResult = {
  id: string;
  name?: string;
  result: unknown;
  isError: boolean;
};

// Provider extension for tool-error stream parts.
type ToolErrorPart = {
  type: 'tool-error';
  toolCallId: string;
  toolName: string;
  error: string;
  providerExecuted: true;
  providerMetadata?: Record<string, JSONValue>;
};

// Local extension of the AI SDK stream part union to include tool-error.
type ExtendedStreamPart = LanguageModelV3StreamPart | ToolErrorPart;

/**
 * Usage data from Claude Code SDK.
 */
type ClaudeCodeUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

/**
 * Creates a zero-initialized usage object for AI SDK v6 stable.
 */
function createEmptyUsage(): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: 0,
      noCache: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    outputTokens: {
      total: 0,
      text: undefined,
      reasoning: undefined,
    },
    raw: undefined,
  };
}

/**
 * Converts Claude Code SDK usage to AI SDK v6 stable usage format.
 *
 * Maps Claude's flat token counts to the nested structure required by AI SDK v6:
 * - `cache_creation_input_tokens` → `inputTokens.cacheWrite`
 * - `cache_read_input_tokens` → `inputTokens.cacheRead`
 * - `input_tokens` → `inputTokens.noCache`
 * - `inputTokens.total` = sum of all input tokens
 * - `output_tokens` → `outputTokens.total`
 *
 * @param usage - Raw usage data from Claude Code SDK
 * @returns Formatted usage object for AI SDK v6
 */
function convertClaudeCodeUsage(usage: ClaudeCodeUsage): LanguageModelV3Usage {
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;

  return {
    inputTokens: {
      total: inputTokens + cacheWrite + cacheRead,
      noCache: inputTokens,
      cacheRead,
      cacheWrite,
    },
    outputTokens: {
      total: outputTokens,
      text: undefined,
      reasoning: undefined,
    },
    raw: usage as JSONObject,
  };
}

/**
 * Tracks the streaming lifecycle state for a single tool invocation.
 *
 * The tool streaming lifecycle follows this sequence:
 * 1. Tool use detected → state created with all flags false
 * 2. First input seen → `inputStarted` = true, emit `tool-input-start`
 * 3. Input deltas streamed → emit `tool-input-delta` (may be skipped for large/non-prefix updates)
 * 4. Input finalized → `inputClosed` = true, emit `tool-input-end`
 * 5. Tool call formed → `callEmitted` = true, emit `tool-call`
 * 6. Tool results/errors arrive → emit `tool-result` or `tool-error` (may occur multiple times)
 * 7. Stream ends → state cleaned up by `finalizeToolCalls()`
 *
 * @property name - Tool name from SDK (e.g., "Bash", "Read")
 * @property lastSerializedInput - Most recent serialized input, used for delta calculation
 * @property inputStarted - True after `tool-input-start` emitted; prevents duplicate start events
 * @property inputClosed - True after `tool-input-end` emitted; ensures proper event ordering
 * @property callEmitted - True after `tool-call` emitted; prevents duplicate call events when
 *                         multiple result/error chunks arrive for the same tool invocation
 */
type ToolStreamState = {
  name: string;
  lastSerializedInput?: string;
  inputStarted: boolean;
  inputClosed: boolean;
  callEmitted: boolean;
  parentToolCallId?: string | null;
};

/**
 * Queued injection item with content and optional delivery callback.
 */
type QueuedInjection = {
  content: string;
  onResult?: (delivered: boolean) => void;
};

/**
 * Creates a MessageInjector implementation that can queue messages for mid-session injection.
 * The injector uses a queue and signals to coordinate between the producer (user code)
 * and consumer (async generator).
 *
 * Note: getNextItem returns the full QueuedInjection so the consumer can call onResult
 * AFTER successfully yielding, avoiding a race condition with outputStreamEnded.
 */
function createMessageInjector(): {
  injector: MessageInjector;
  getNextItem: () => Promise<QueuedInjection | null>;
  notifySessionEnded: () => void;
} {
  const queue: QueuedInjection[] = [];
  let closed = false;
  let resolver: ((item: QueuedInjection | null) => void) | null = null;

  const injector: MessageInjector = {
    inject(content, onResult) {
      if (closed) {
        // Already closed - immediately notify not delivered
        onResult?.(false);
        return;
      }
      const item: QueuedInjection = { content, onResult };
      if (resolver) {
        // Consumer is waiting, resolve immediately
        const r = resolver;
        resolver = null;
        r(item);
      } else {
        // Queue for later consumption
        queue.push(item);
      }
    },
    close() {
      // Stop accepting new messages, but don't cancel pending ones
      // Pending messages can still be delivered until session ends
      closed = true;
      if (resolver && queue.length === 0) {
        // No pending messages and consumer is waiting - signal done
        resolver(null);
        resolver = null;
      }
    },
  };

  const getNextItem = (): Promise<QueuedInjection | null> => {
    if (queue.length > 0) {
      const item = queue.shift();
      if (!item) {
        return Promise.resolve(null);
      }
      // Return the full item - caller is responsible for calling onResult after yielding
      return Promise.resolve(item);
    }
    if (closed) {
      // Closed and queue is empty - no more messages
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      resolver = (item) => {
        // Return the full item (or null) - caller handles onResult
        resolve(item);
      };
    });
  };

  const notifySessionEnded = () => {
    // Session ended - any remaining queued messages won't be delivered
    for (const item of queue) {
      item.onResult?.(false);
    }
    queue.length = 0;
    closed = true;
    if (resolver) {
      resolver(null);
      resolver = null;
    }
  };

  return { injector, getNextItem, notifySessionEnded };
}

function toAsyncIterablePrompt(
  messagesPrompt: string,
  outputStreamEnded: Promise<unknown>,
  sessionId?: string,
  contentParts?: SDKUserMessage['message']['content'],
  onStreamStart?: (injector: MessageInjector) => void
): AsyncIterable<SDKUserMessage> {
  const content = (
    contentParts && contentParts.length > 0
      ? contentParts
      : [{ type: 'text', text: messagesPrompt }]
  ) as SDKUserMessage['message']['content'];

  const initialMsg: SDKUserMessage = {
    type: 'user',
    message: {
      role: 'user',
      content,
    },
    parent_tool_use_id: null,
    session_id: sessionId ?? '',
  };

  // If no callback, use simple behavior (backwards compatible)
  if (!onStreamStart) {
    return {
      async *[Symbol.asyncIterator]() {
        yield initialMsg;
        await outputStreamEnded;
      },
    };
  }

  // With injection support: create injector and yield messages as they arrive
  const { injector, getNextItem, notifySessionEnded } = createMessageInjector();

  return {
    async *[Symbol.asyncIterator]() {
      // Yield initial message
      yield initialMsg;

      // Notify consumer that streaming has started
      onStreamStart(injector);

      // Race between output ending and new messages arriving
      let streamEnded = false;
      void outputStreamEnded.then(() => {
        streamEnded = true;
        // Notify any pending injections that the session ended
        notifySessionEnded();
      });

      // Keep yielding injected messages until stream ends or injector closes
      while (!streamEnded) {
        // Race getNextItem against outputStreamEnded
        // We get the full item so we can call onResult AFTER yielding
        const item = await Promise.race([getNextItem(), outputStreamEnded.then(() => null)]);

        if (item === null) {
          // Ensure we don't close the input stream prematurely.
          // Wait for output to complete to avoid truncation issues.
          await outputStreamEnded;
          break;
        }

        const sdkMsg: SDKUserMessage = {
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'text', text: item.content }],
          },
          parent_tool_use_id: null,
          session_id: sessionId ?? '',
        };
        yield sdkMsg;

        // Only report delivery AFTER successfully yielding
        item.onResult?.(true);
      }
    },
  };
}

/**
 * Options for creating a Claude Code language model instance.
 *
 * @example
 * ```typescript
 * const model = new ClaudeCodeLanguageModel({
 *   id: 'opus',
 *   settings: {
 *     maxTurns: 10,
 *     permissionMode: 'auto'
 *   }
 * });
 * ```
 */
export interface ClaudeCodeLanguageModelOptions {
  /**
   * The model identifier to use.
   * Can be 'opus', 'sonnet', 'haiku', or a custom model string.
   */
  id: ClaudeCodeModelId;

  /**
   * Optional settings to configure the model behavior.
   */
  settings?: ClaudeCodeSettings;

  /**
   * Validation warnings from settings validation.
   * Used internally to pass warnings from provider.
   */
  settingsValidationWarnings?: string[];
}

/**
 * Supported Claude model identifiers.
 * - 'opus': Claude Opus (most capable)
 * - 'sonnet': Claude Sonnet (balanced performance)
 * - 'haiku': Claude Haiku (fastest, most cost-effective)
 * - Custom string: Any full model identifier (e.g., 'claude-opus-4-5', 'claude-sonnet-4-5-20250514')
 *
 * @example
 * ```typescript
 * const opusModel = claudeCode('opus');
 * const sonnetModel = claudeCode('sonnet');
 * const haikuModel = claudeCode('haiku');
 * const customModel = claudeCode('claude-opus-4-5');
 * ```
 */
export type ClaudeCodeModelId = 'opus' | 'sonnet' | 'haiku' | (string & {});

const modelMap: Record<string, string> = {
  opus: 'opus',
  sonnet: 'sonnet',
  haiku: 'haiku',
};

/**
 * Maximum size for tool results sent to the client stream.
 * Interior Claude Code process has full data; this only affects client stream.
 */
const MAX_TOOL_RESULT_SIZE = 10000;

/**
 * Truncates large tool results to prevent stream bloat.
 * Only the largest string value in an object/array is truncated.
 * Preserves the original type (array stays array, object stays object).
 */
function truncateToolResultForStream(
  result: unknown,
  maxSize: number = MAX_TOOL_RESULT_SIZE
): unknown {
  if (typeof result === 'string') {
    if (result.length <= maxSize) return result;
    return result.slice(0, maxSize) + `\n...[truncated ${result.length - maxSize} chars]`;
  }

  if (typeof result !== 'object' || result === null) return result;

  // Handle arrays separately to preserve array type
  if (Array.isArray(result)) {
    let largestIndex = -1;
    let largestSize = 0;

    for (let i = 0; i < result.length; i++) {
      const value = result[i];
      if (typeof value === 'string' && value.length > largestSize) {
        largestIndex = i;
        largestSize = value.length;
      }
    }

    if (largestIndex >= 0 && largestSize > maxSize) {
      const truncatedValue =
        (result[largestIndex] as string).slice(0, maxSize) +
        `\n...[truncated ${largestSize - maxSize} chars]`;
      const cloned = [...result];
      cloned[largestIndex] = truncatedValue;
      return cloned;
    }

    return result;
  }

  // For objects, find and truncate only the largest string value
  const obj = result as Record<string, unknown>;
  let largestKey: string | null = null;
  let largestSize = 0;

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && value.length > largestSize) {
      largestKey = key;
      largestSize = value.length;
    }
  }

  if (largestKey && largestSize > maxSize) {
    const truncatedValue =
      (obj[largestKey] as string).slice(0, maxSize) +
      `\n...[truncated ${largestSize - maxSize} chars]`;
    return { ...obj, [largestKey]: truncatedValue };
  }

  return result;
}

/**
 * Language model implementation for Claude Code SDK.
 * This class implements the AI SDK's LanguageModelV3 interface to provide
 * integration with Claude models through the Claude Agent SDK.
 *
 * Features:
 * - Supports streaming and non-streaming generation
 * - Native structured outputs via SDK's outputFormat (guaranteed schema compliance)
 * - Manages CLI sessions for conversation continuity
 * - Provides detailed error handling and retry logic
 *
 * Limitations:
 * - Image inputs require streaming mode
 * - Some parameters like temperature and max tokens are not supported by the CLI
 *
 * @example
 * ```typescript
 * const model = new ClaudeCodeLanguageModel({
 *   id: 'opus',
 *   settings: { maxTurns: 5 }
 * });
 *
 * const result = await model.doGenerate({
 *   prompt: [{ role: 'user', content: 'Hello!' }],
 *   mode: { type: 'regular' }
 * });
 * ```
 */

export class ClaudeCodeLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly defaultObjectGenerationMode = 'json' as const;
  readonly supportsImageUrls = false;
  readonly supportedUrls = {};
  readonly supportsStructuredOutputs = true;

  // Fallback/magic string constants
  static readonly UNKNOWN_TOOL_NAME = 'unknown-tool';

  // Tool input safety limits
  private static readonly MAX_TOOL_INPUT_SIZE = 1_048_576; // 1MB hard limit
  private static readonly MAX_TOOL_INPUT_WARN = 102_400; // 100KB warning threshold
  private static readonly MAX_DELTA_CALC_SIZE = 10_000; // 10KB delta computation threshold

  readonly modelId: ClaudeCodeModelId;
  readonly settings: ClaudeCodeSettings;

  private sessionId?: string;
  private modelValidationWarning?: string;
  private settingsValidationWarnings: string[];
  private logger: Logger;

  constructor(options: ClaudeCodeLanguageModelOptions) {
    this.modelId = options.id;
    this.settings = options.settings ?? {};
    this.settingsValidationWarnings = options.settingsValidationWarnings ?? [];

    // Create logger that respects verbose setting
    const baseLogger = getLogger(this.settings.logger);
    this.logger = createVerboseLogger(baseLogger, this.settings.verbose ?? false);

    // Validate model ID format
    if (!this.modelId || typeof this.modelId !== 'string' || this.modelId.trim() === '') {
      throw new NoSuchModelError({
        modelId: this.modelId,
        modelType: 'languageModel',
      });
    }

    // Additional model ID validation
    this.modelValidationWarning = validateModelId(this.modelId);
    if (this.modelValidationWarning) {
      this.logger.warn(`Claude Code Model: ${this.modelValidationWarning}`);
    }
  }

  get provider(): string {
    return 'claude-code';
  }

  private getModel(): string {
    const mapped = modelMap[this.modelId];
    return mapped ?? this.modelId;
  }

  private getSanitizedSdkOptions(): Partial<Options> | undefined {
    if (!this.settings.sdkOptions || typeof this.settings.sdkOptions !== 'object') {
      return undefined;
    }

    const sanitized = { ...(this.settings.sdkOptions as Record<string, unknown>) };
    const blockedKeys = Array.from(SDK_OPTIONS_BLOCKLIST).filter((key) => key in sanitized);

    if (blockedKeys.length > 0) {
      this.logger.warn(
        `[claude-code] sdkOptions includes provider-managed fields (${blockedKeys.join(
          ', '
        )}); these will be ignored.`
      );
      blockedKeys.forEach((key) => delete sanitized[key]);
    }

    return sanitized as Partial<Options>;
  }

  private getEffectiveResume(sdkOptions?: Partial<Options>): string | undefined {
    return sdkOptions?.resume ?? this.settings.resume ?? this.sessionId;
  }

  private extractToolUses(content: unknown): ClaudeToolUse[] {
    if (!Array.isArray(content)) {
      return [];
    }

    return content
      .filter(
        (item): item is { type: string; id?: unknown; name?: unknown; input?: unknown } =>
          typeof item === 'object' &&
          item !== null &&
          'type' in item &&
          (item as { type: unknown }).type === 'tool_use'
      )
      .map((item) => {
        const { id, name, input, parent_tool_use_id } = item as {
          id?: unknown;
          name?: unknown;
          input?: unknown;
          parent_tool_use_id?: unknown;
        };
        return {
          id: typeof id === 'string' && id.length > 0 ? id : generateId(),
          name:
            typeof name === 'string' && name.length > 0
              ? name
              : ClaudeCodeLanguageModel.UNKNOWN_TOOL_NAME,
          input,
          parentToolUseId: typeof parent_tool_use_id === 'string' ? parent_tool_use_id : null,
        } satisfies ClaudeToolUse;
      });
  }

  private extractToolResults(content: unknown): ClaudeToolResult[] {
    if (!Array.isArray(content)) {
      return [];
    }

    return content
      .filter(
        (
          item
        ): item is {
          type: string;
          tool_use_id?: unknown;
          content?: unknown;
          is_error?: unknown;
          name?: unknown;
        } =>
          typeof item === 'object' &&
          item !== null &&
          'type' in item &&
          (item as { type: unknown }).type === 'tool_result'
      )
      .map((item) => {
        const { tool_use_id, content, is_error, name } = item;
        return {
          id:
            typeof tool_use_id === 'string' && tool_use_id.length > 0 ? tool_use_id : generateId(),
          name: typeof name === 'string' && name.length > 0 ? name : undefined,
          result: content,
          isError: Boolean(is_error),
        } satisfies ClaudeToolResult;
      });
  }

  private extractToolErrors(content: unknown): Array<{
    id: string;
    name?: string;
    error: unknown;
  }> {
    if (!Array.isArray(content)) {
      return [];
    }

    return content
      .filter(
        (
          item
        ): item is {
          type: string;
          tool_use_id?: unknown;
          error?: unknown;
          name?: unknown;
        } =>
          typeof item === 'object' &&
          item !== null &&
          'type' in item &&
          (item as { type: unknown }).type === 'tool_error'
      )
      .map((item) => {
        const { tool_use_id, error, name } = item as {
          tool_use_id?: unknown;
          error?: unknown;
          name?: unknown;
        };
        return {
          id:
            typeof tool_use_id === 'string' && tool_use_id.length > 0 ? tool_use_id : generateId(),
          name: typeof name === 'string' && name.length > 0 ? name : undefined,
          error,
        };
      });
  }

  private serializeToolInput(input: unknown): string {
    if (typeof input === 'string') {
      return this.checkInputSize(input);
    }

    if (input === undefined) {
      return '';
    }

    try {
      const serialized = JSON.stringify(input);
      return this.checkInputSize(serialized);
    } catch {
      const fallback = String(input);
      return this.checkInputSize(fallback);
    }
  }

  private checkInputSize(str: string): string {
    const length = str.length;

    if (length > ClaudeCodeLanguageModel.MAX_TOOL_INPUT_SIZE) {
      throw new Error(
        `Tool input exceeds maximum size of ${ClaudeCodeLanguageModel.MAX_TOOL_INPUT_SIZE} bytes (got ${length} bytes). This may indicate a malformed request or an attempt to process excessively large data.`
      );
    }

    if (length > ClaudeCodeLanguageModel.MAX_TOOL_INPUT_WARN) {
      this.logger.warn(
        `[claude-code] Large tool input detected: ${length} bytes. Performance may be impacted. Consider chunking or reducing input size.`
      );
    }

    return str;
  }

  private normalizeToolResult(result: unknown): unknown {
    if (typeof result === 'string') {
      try {
        return JSON.parse(result);
      } catch {
        return result;
      }
    }
    // Handle MCP content format: [{type: 'text', text: '...'}, ...]
    // MCP tools can return multiple content blocks; only normalize when all blocks are text.
    if (Array.isArray(result) && result.length > 0) {
      // Collect all text content from text blocks
      const textBlocks = result
        .filter(
          (block): block is { type: 'text'; text: string } =>
            block?.type === 'text' && typeof block.text === 'string'
        )
        .map((block) => block.text);

      if (textBlocks.length !== result.length) {
        return result;
      }

      // If single text block, try to parse as JSON
      if (textBlocks.length === 1) {
        try {
          return JSON.parse(textBlocks[0]);
        } catch {
          return textBlocks[0];
        }
      }

      // Multiple text blocks: join them and try to parse as JSON
      const combined = textBlocks.join('\n');
      try {
        return JSON.parse(combined);
      } catch {
        return combined;
      }
    }

    return result;
  }

  private generateAllWarnings(
    options:
      | Parameters<LanguageModelV3['doGenerate']>[0]
      | Parameters<LanguageModelV3['doStream']>[0],
    prompt: string
  ): SharedV3Warning[] {
    const warnings: SharedV3Warning[] = [];
    const unsupportedParams: string[] = [];

    // Check for unsupported parameters
    if (options.temperature !== undefined) unsupportedParams.push('temperature');
    if (options.topP !== undefined) unsupportedParams.push('topP');
    if (options.topK !== undefined) unsupportedParams.push('topK');
    if (options.presencePenalty !== undefined) unsupportedParams.push('presencePenalty');
    if (options.frequencyPenalty !== undefined) unsupportedParams.push('frequencyPenalty');
    if (options.stopSequences !== undefined && options.stopSequences.length > 0)
      unsupportedParams.push('stopSequences');
    if (options.seed !== undefined) unsupportedParams.push('seed');

    if (unsupportedParams.length > 0) {
      // Add a warning for each unsupported parameter
      for (const param of unsupportedParams) {
        warnings.push({
          type: 'unsupported',
          feature: param,
          details: `Claude Code SDK does not support the ${param} parameter. It will be ignored.`,
        });
      }
    }

    // Add model validation warning if present
    if (this.modelValidationWarning) {
      warnings.push({
        type: 'other',
        message: this.modelValidationWarning,
      });
    }

    // Add settings validation warnings
    this.settingsValidationWarnings.forEach((warning) => {
      warnings.push({
        type: 'other',
        message: warning,
      });
    });

    // Warn if JSON response format is requested without a schema
    // Claude Code only supports structured outputs with schemas (like Anthropic's API)
    if (options.responseFormat?.type === 'json' && !options.responseFormat.schema) {
      warnings.push({
        type: 'unsupported',
        feature: 'responseFormat',
        details:
          'JSON response format requires a schema for the Claude Code provider. The JSON responseFormat is ignored and the call is treated as plain text.',
      });
    }

    // Validate prompt
    const promptWarning = validatePrompt(prompt);
    if (promptWarning) {
      warnings.push({
        type: 'other',
        message: promptWarning,
      });
    }

    return warnings;
  }

  private createQueryOptions(
    abortController: AbortController,
    responseFormat?: Parameters<LanguageModelV3['doGenerate']>[0]['responseFormat'],
    stderrCollector?: (data: string) => void,
    sdkOptions?: Partial<Options>,
    effectiveResume?: string
  ): Options {
    const opts: Partial<Options> & Record<string, unknown> = {
      model: this.getModel(),
      abortController,
      resume: effectiveResume ?? this.settings.resume ?? this.sessionId,
      pathToClaudeCodeExecutable: this.settings.pathToClaudeCodeExecutable,
      maxTurns: this.settings.maxTurns,
      maxThinkingTokens: this.settings.maxThinkingTokens,
      cwd: this.settings.cwd,
      executable: this.settings.executable,
      executableArgs: this.settings.executableArgs,
      permissionMode: this.settings.permissionMode,
      permissionPromptToolName: this.settings.permissionPromptToolName,
      continue: this.settings.continue,
      allowedTools: this.settings.allowedTools,
      disallowedTools: this.settings.disallowedTools,
      betas: this.settings.betas,
      allowDangerouslySkipPermissions: this.settings.allowDangerouslySkipPermissions,
      enableFileCheckpointing: this.settings.enableFileCheckpointing,
      maxBudgetUsd: this.settings.maxBudgetUsd,
      plugins: this.settings.plugins,
      resumeSessionAt: this.settings.resumeSessionAt,
      sandbox: this.settings.sandbox,
      tools: this.settings.tools,
      mcpServers: this.settings.mcpServers,
      canUseTool: this.settings.canUseTool,
    };
    // NEW: Agent SDK options with legacy mapping
    if (this.settings.systemPrompt !== undefined) {
      opts.systemPrompt = this.settings.systemPrompt;
    } else if (this.settings.customSystemPrompt !== undefined) {
      // Deprecation warning for legacy field
      this.logger.warn(
        "[claude-code] 'customSystemPrompt' is deprecated and will be removed in a future major release. Please use 'systemPrompt' instead (string or { type: 'preset', preset: 'claude_code', append? })."
      );
      opts.systemPrompt = this.settings.customSystemPrompt;
    } else if (this.settings.appendSystemPrompt !== undefined) {
      // Deprecation warning for legacy field
      this.logger.warn(
        "[claude-code] 'appendSystemPrompt' is deprecated and will be removed in a future major release. Please use 'systemPrompt: { type: 'preset', preset: 'claude_code', append: <text> }' instead."
      );
      opts.systemPrompt = {
        type: 'preset',
        preset: 'claude_code',
        append: this.settings.appendSystemPrompt,
      } as const;
    }
    if (this.settings.settingSources !== undefined) {
      opts.settingSources = this.settings.settingSources;
    }
    if (this.settings.additionalDirectories !== undefined) {
      opts.additionalDirectories = this.settings.additionalDirectories;
    }
    if (this.settings.agents !== undefined) {
      opts.agents = this.settings.agents;
    }
    if (this.settings.includePartialMessages !== undefined) {
      opts.includePartialMessages = this.settings.includePartialMessages;
    }
    if (this.settings.fallbackModel !== undefined) {
      opts.fallbackModel = this.settings.fallbackModel;
    }
    if (this.settings.forkSession !== undefined) {
      opts.forkSession = this.settings.forkSession;
    }
    if (this.settings.strictMcpConfig !== undefined) {
      opts.strictMcpConfig = this.settings.strictMcpConfig;
    }
    if (this.settings.extraArgs !== undefined) {
      opts.extraArgs = this.settings.extraArgs;
    }
    if (this.settings.persistSession !== undefined) {
      opts.persistSession = this.settings.persistSession;
    }
    if (this.settings.spawnClaudeCodeProcess !== undefined) {
      opts.spawnClaudeCodeProcess = this.settings.spawnClaudeCodeProcess;
    }
    // hooks is supported in newer SDKs; include it if provided
    if (this.settings.hooks) {
      opts.hooks = this.settings.hooks;
    }
    if (this.settings.sessionId !== undefined) {
      opts.sessionId = this.settings.sessionId;
    }
    if (this.settings.debug !== undefined) {
      opts.debug = this.settings.debug;
    }
    if (this.settings.debugFile !== undefined) {
      opts.debugFile = this.settings.debugFile;
    }

    const sdkOverrides = sdkOptions
      ? (sdkOptions as Partial<Options> & Record<string, unknown>)
      : undefined;
    const sdkEnv =
      sdkOverrides && typeof sdkOverrides.env === 'object' && sdkOverrides.env !== null
        ? (sdkOverrides.env as Record<string, string | undefined>)
        : undefined;
    const sdkStderr =
      sdkOverrides && typeof sdkOverrides.stderr === 'function'
        ? (sdkOverrides.stderr as (data: string) => void)
        : undefined;
    if (sdkOverrides) {
      const rest = { ...sdkOverrides };
      delete rest.env;
      delete rest.stderr;
      Object.assign(opts, rest);
    }

    // Wrap stderr callback to also collect data for error reporting
    const userStderrCallback = sdkStderr ?? this.settings.stderr;
    if (stderrCollector || userStderrCallback) {
      opts.stderr = (data: string) => {
        if (stderrCollector) stderrCollector(data);
        if (userStderrCallback) userStderrCallback(data);
      };
    }

    if (this.settings.env !== undefined || sdkEnv !== undefined) {
      const baseEnv = getBaseProcessEnv();
      opts.env = { ...baseEnv, ...this.settings.env, ...sdkEnv };
    }

    // Native structured outputs (SDK 0.1.45+)
    if (responseFormat?.type === 'json' && responseFormat.schema) {
      opts.outputFormat = {
        type: 'json_schema',
        schema: responseFormat.schema as Record<string, unknown>,
      };
    }

    return opts as Options;
  }

  private handleClaudeCodeError(
    error: unknown,
    messagesPrompt: string,
    collectedStderr?: string
  ): APICallError | LoadAPIKeyError {
    // Handle AbortError from the SDK
    if (isAbortError(error)) {
      // Return the abort reason if available, otherwise the error itself
      throw error;
    }

    // Type guard for error with properties
    const isErrorWithMessage = (err: unknown): err is { message?: string } => {
      return typeof err === 'object' && err !== null && 'message' in err;
    };

    const isErrorWithCode = (
      err: unknown
    ): err is { code?: string; exitCode?: number; stderr?: string } => {
      return typeof err === 'object' && err !== null;
    };

    // Check for authentication errors with improved detection
    const authErrorPatterns = [
      'not logged in',
      'authentication',
      'unauthorized',
      'auth failed',
      'please login',
      'claude login',
      'claude auth login',
      '/login', // CLI returns "Please run /login"
      'invalid api key',
    ];

    const errorMessage =
      isErrorWithMessage(error) && error.message ? error.message.toLowerCase() : '';

    const exitCode =
      isErrorWithCode(error) && typeof error.exitCode === 'number' ? error.exitCode : undefined;

    const isAuthError =
      authErrorPatterns.some((pattern) => errorMessage.includes(pattern)) || exitCode === 401;

    if (isAuthError) {
      return createAuthenticationError({
        message:
          isErrorWithMessage(error) && error.message
            ? error.message
            : 'Authentication failed. Please ensure Claude Code SDK is properly authenticated.',
      });
    }

    // Check for timeout errors
    const errorCode = isErrorWithCode(error) && typeof error.code === 'string' ? error.code : '';

    if (errorCode === 'ETIMEDOUT' || errorMessage.includes('timeout')) {
      return createTimeoutError({
        message: isErrorWithMessage(error) && error.message ? error.message : 'Request timed out',
        promptExcerpt: messagesPrompt.substring(0, 200),
        // Don't specify timeoutMs since we don't know the actual timeout value
        // It's controlled by the consumer via AbortSignal
      });
    }

    // Create general API call error with appropriate retry flag
    const isRetryable =
      errorCode === 'ENOENT' ||
      errorCode === 'ECONNREFUSED' ||
      errorCode === 'ETIMEDOUT' ||
      errorCode === 'ECONNRESET';

    // Use error.stderr if available from SDK, otherwise use collected stderr
    const stderrFromError =
      isErrorWithCode(error) && typeof error.stderr === 'string' ? error.stderr : undefined;
    const stderr = stderrFromError || collectedStderr || undefined;

    return createAPICallError({
      message: isErrorWithMessage(error) && error.message ? error.message : 'Claude Code SDK error',
      code: errorCode || undefined,
      exitCode: exitCode,
      stderr,
      promptExcerpt: messagesPrompt.substring(0, 200),
      isRetryable,
    });
  }

  private setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
    const warning = validateSessionId(sessionId);
    if (warning) {
      this.logger.warn(`Claude Code Session: ${warning}`);
    }
  }

  private logMcpConnectionIssues(
    mcpServers: Array<{ name?: string; status?: string; error?: string }> | undefined
  ): void {
    if (!Array.isArray(mcpServers) || mcpServers.length === 0) {
      return;
    }

    const serversNeedingAttention = mcpServers.filter((server) => {
      const status = typeof server.status === 'string' ? server.status.toLowerCase() : '';
      return status === 'failed' || status === 'needs-auth';
    });

    if (serversNeedingAttention.length === 0) {
      return;
    }

    const details = serversNeedingAttention
      .map((server) => {
        const name =
          typeof server.name === 'string' && server.name.trim().length > 0
            ? server.name
            : '<unknown>';
        const status =
          typeof server.status === 'string' && server.status.trim().length > 0
            ? server.status
            : 'unknown';
        const error =
          typeof server.error === 'string' && server.error.trim().length > 0
            ? ` (${server.error})`
            : '';
        return `${name}:${status}${error}`;
      })
      .join(', ');

    this.logger.warn(`[claude-code] MCP servers not connected: ${details}`);
  }

  async doGenerate(
    options: Parameters<LanguageModelV3['doGenerate']>[0]
  ): Promise<Awaited<ReturnType<LanguageModelV3['doGenerate']>>> {
    this.logger.debug(`[claude-code] Starting doGenerate request with model: ${this.modelId}`);
    this.logger.debug(`[claude-code] Response format: ${options.responseFormat?.type ?? 'none'}`);

    const {
      messagesPrompt,
      warnings: messageWarnings,
      streamingContentParts,
      hasImageParts,
    } = convertToClaudeCodeMessages(options.prompt);

    this.logger.debug(
      `[claude-code] Converted ${options.prompt.length} messages, hasImageParts: ${hasImageParts}`
    );

    const abortController = new AbortController();
    let abortListener: (() => void) | undefined;
    if (options.abortSignal?.aborted) {
      // Propagate already-aborted state immediately with original reason
      abortController.abort(options.abortSignal.reason);
    } else if (options.abortSignal) {
      abortListener = () => abortController.abort(options.abortSignal?.reason);
      options.abortSignal.addEventListener('abort', abortListener, { once: true });
    }

    // Collect stderr for error reporting (SDK may not include it in errors)
    let collectedStderr = '';
    const stderrCollector = (data: string) => {
      collectedStderr += data;
    };

    const sdkOptions = this.getSanitizedSdkOptions();
    const effectiveResume = this.getEffectiveResume(sdkOptions);
    const queryOptions = this.createQueryOptions(
      abortController,
      options.responseFormat,
      stderrCollector,
      sdkOptions,
      effectiveResume
    );

    let text = '';
    let structuredOutput: unknown | undefined;
    let usage: LanguageModelV3Usage = createEmptyUsage();
    let finishReason: LanguageModelV3FinishReason = { unified: 'stop', raw: undefined };
    let wasTruncated = false;
    let costUsd: number | undefined;
    let durationMs: number | undefined;
    let modelUsage: Record<string, unknown> | undefined;
    const warnings: SharedV3Warning[] = this.generateAllWarnings(options, messagesPrompt);

    // Add warnings from message conversion
    if (messageWarnings) {
      messageWarnings.forEach((warning) => {
        warnings.push({
          type: 'other',
          message: warning,
        });
      });
    }

    const modeSetting = this.settings.streamingInput ?? 'auto';
    const effectiveCanUseTool = sdkOptions?.canUseTool ?? this.settings.canUseTool;
    const effectivePermissionPromptToolName =
      sdkOptions?.permissionPromptToolName ?? this.settings.permissionPromptToolName;
    const wantsStreamInput =
      modeSetting === 'always' || (modeSetting === 'auto' && !!effectiveCanUseTool);

    if (!wantsStreamInput && hasImageParts) {
      warnings.push({
        type: 'other',
        message: STREAMING_FEATURE_WARNING,
      });
    }

    let done = () => {};
    const outputStreamEnded = new Promise((resolve) => {
      done = () => resolve(undefined);
    });
    try {
      if (effectiveCanUseTool && effectivePermissionPromptToolName) {
        throw new Error(
          "canUseTool requires streamingInput mode ('auto' or 'always') and cannot be used with permissionPromptToolName (SDK constraint). Set streamingInput: 'auto' (or 'always') and remove permissionPromptToolName, or remove canUseTool."
        );
      }
      // hold input stream open until results
      // see: https://github.com/anthropics/claude-code/issues/4775
      const sdkPrompt = wantsStreamInput
        ? toAsyncIterablePrompt(
            messagesPrompt,
            outputStreamEnded,
            effectiveResume,
            streamingContentParts,
            this.settings.onStreamStart
          )
        : messagesPrompt;

      this.logger.debug(
        `[claude-code] Executing query with streamingInput: ${wantsStreamInput}, session: ${effectiveResume ?? 'new'}`
      );

      const response = query({
        prompt: sdkPrompt,
        options: queryOptions,
      });

      // Invoke onQueryCreated callback to expose Query object for advanced features
      // like mid-stream message injection via query.streamInput()
      this.settings.onQueryCreated?.(response);

      for await (const message of response) {
        this.logger.debug(`[claude-code] Received message type: ${message.type}`);
        if (message.type === 'assistant') {
          text += message.message.content
            .map((c: { type: string; text?: string }) => (c.type === 'text' ? c.text : ''))
            .join('');
        } else if (message.type === 'result') {
          done();
          this.setSessionId(message.session_id);
          costUsd = message.total_cost_usd;
          durationMs = message.duration_ms;
          modelUsage = message.modelUsage;

          // Handle is_error flag in result message (e.g., auth failures)
          // The CLI returns successful JSON with is_error: true and error message in result field
          if ('is_error' in message && message.is_error === true) {
            const errorMessage =
              'result' in message && typeof message.result === 'string'
                ? message.result
                : 'Claude Code CLI returned an error';
            throw Object.assign(new Error(errorMessage), { exitCode: 1 });
          }

          // Handle structured output errors (SDK 0.1.45+)
          // Use string comparison to support new SDK subtypes not yet in TypeScript definitions
          if ((message.subtype as string) === 'error_max_structured_output_retries') {
            throw new Error(
              'Failed to generate valid structured output after maximum retries. The model could not produce a response matching the required schema.'
            );
          }

          // Capture structured output if available (SDK 0.1.45+)
          if ('structured_output' in message && message.structured_output !== undefined) {
            structuredOutput = message.structured_output;
            this.logger.debug('[claude-code] Received structured output from SDK');
          }

          this.logger.info(
            `[claude-code] Request completed - Session: ${message.session_id}, Cost: $${costUsd?.toFixed(4) ?? 'N/A'}, Duration: ${durationMs ?? 'N/A'}ms`
          );

          if ('usage' in message) {
            usage = convertClaudeCodeUsage(message.usage);

            this.logger.debug(
              `[claude-code] Token usage - Input: ${usage.inputTokens.total}, Output: ${usage.outputTokens.total}`
            );
          }

          const stopReason =
            'stop_reason' in message
              ? ((message as Record<string, unknown>).stop_reason as string | null | undefined)
              : undefined;
          finishReason = mapClaudeCodeFinishReason(message.subtype, stopReason);
          this.logger.debug(`[claude-code] Finish reason: ${finishReason.unified}`);
        } else if (message.type === 'system' && message.subtype === 'init') {
          this.logMcpConnectionIssues(message.mcp_servers);
          this.setSessionId(message.session_id);
          this.logger.info(`[claude-code] Session initialized: ${message.session_id}`);
        }
      }
    } catch (error: unknown) {
      done();
      this.logger.debug(
        `[claude-code] Error during doGenerate: ${error instanceof Error ? error.message : String(error)}`
      );

      // Special handling for AbortError to preserve abort signal reason
      if (isAbortError(error)) {
        this.logger.debug('[claude-code] Request aborted by user');
        throw options.abortSignal?.aborted ? options.abortSignal.reason : error;
      }

      if (isClaudeCodeTruncationError(error, text)) {
        this.logger.warn(
          `[claude-code] Detected truncated response, returning ${text.length} characters of buffered text`
        );
        wasTruncated = true;
        finishReason = { unified: 'length', raw: 'truncation' };
        warnings.push({
          type: 'other',
          message: CLAUDE_CODE_TRUNCATION_WARNING,
        });
      } else {
        // Use unified error handler
        throw this.handleClaudeCodeError(error, messagesPrompt, collectedStderr);
      }
    } finally {
      if (options.abortSignal && abortListener) {
        options.abortSignal.removeEventListener('abort', abortListener);
      }
    }

    // Use structured output from SDK if available (native JSON schema support)
    // Otherwise fall back to accumulated text
    const finalText = structuredOutput !== undefined ? JSON.stringify(structuredOutput) : text;

    return {
      content: [{ type: 'text', text: finalText }],
      usage,
      finishReason,
      warnings,
      response: {
        id: generateId(),
        timestamp: new Date(),
        modelId: this.modelId,
      },
      request: {
        body: messagesPrompt,
      },
      providerMetadata: {
        'claude-code': {
          ...(this.sessionId !== undefined && { sessionId: this.sessionId }),
          ...(costUsd !== undefined && { costUsd }),
          ...(durationMs !== undefined && { durationMs }),
          ...(modelUsage !== undefined && { modelUsage: modelUsage as unknown as JSONValue }),
          ...(wasTruncated && { truncated: true }),
        },
      },
    };
  }

  async doStream(
    options: Parameters<LanguageModelV3['doStream']>[0]
  ): Promise<Awaited<ReturnType<LanguageModelV3['doStream']>>> {
    this.logger.debug(`[claude-code] Starting doStream request with model: ${this.modelId}`);
    this.logger.debug(`[claude-code] Response format: ${options.responseFormat?.type ?? 'none'}`);

    const {
      messagesPrompt,
      warnings: messageWarnings,
      streamingContentParts,
      hasImageParts,
    } = convertToClaudeCodeMessages(options.prompt);

    this.logger.debug(
      `[claude-code] Converted ${options.prompt.length} messages for streaming, hasImageParts: ${hasImageParts}`
    );

    const abortController = new AbortController();
    let abortListener: (() => void) | undefined;
    if (options.abortSignal?.aborted) {
      // Propagate already-aborted state immediately with original reason
      abortController.abort(options.abortSignal.reason);
    } else if (options.abortSignal) {
      abortListener = () => abortController.abort(options.abortSignal?.reason);
      options.abortSignal.addEventListener('abort', abortListener, { once: true });
    }

    // Collect stderr for error reporting (SDK may not include it in errors)
    let collectedStderr = '';
    const stderrCollector = (data: string) => {
      collectedStderr += data;
    };

    const sdkOptions = this.getSanitizedSdkOptions();
    const effectiveResume = this.getEffectiveResume(sdkOptions);
    const queryOptions = this.createQueryOptions(
      abortController,
      options.responseFormat,
      stderrCollector,
      sdkOptions,
      effectiveResume
    );

    // Enable partial messages for true streaming (token-by-token delivery)
    // This can be overridden by user settings, but we default to true for doStream
    if (queryOptions.includePartialMessages === undefined) {
      queryOptions.includePartialMessages = true;
    }

    const warnings: SharedV3Warning[] = this.generateAllWarnings(options, messagesPrompt);

    // Add warnings from message conversion
    if (messageWarnings) {
      messageWarnings.forEach((warning) => {
        warnings.push({
          type: 'other',
          message: warning,
        });
      });
    }

    const modeSetting = this.settings.streamingInput ?? 'auto';
    const effectiveCanUseTool = sdkOptions?.canUseTool ?? this.settings.canUseTool;
    const effectivePermissionPromptToolName =
      sdkOptions?.permissionPromptToolName ?? this.settings.permissionPromptToolName;
    const wantsStreamInput =
      modeSetting === 'always' || (modeSetting === 'auto' && !!effectiveCanUseTool);

    if (!wantsStreamInput && hasImageParts) {
      warnings.push({
        type: 'other',
        message: STREAMING_FEATURE_WARNING,
      });
    }

    const stream = new ReadableStream<ExtendedStreamPart>({
      start: async (controller) => {
        let done = () => {};
        const outputStreamEnded = new Promise((resolve) => {
          done = () => resolve(undefined);
        });
        const toolStates = new Map<string, ToolStreamState>();
        // Track active Task tools for subagent hierarchy
        // Using a Map instead of stack to correctly handle parallel agents
        const activeTaskTools = new Map<string, { startTime: number }>();

        // Helper to get fallback parent - only returns a parent when exactly ONE Task is active
        // This prevents incorrect grouping when parallel agents run simultaneously
        const getFallbackParentId = (): string | null => {
          if (activeTaskTools.size === 1) {
            return activeTaskTools.keys().next().value ?? null;
          }
          return null;
        };

        const streamWarnings: SharedV3Warning[] = [];

        const closeToolInput = (toolId: string, state: ToolStreamState) => {
          if (!state.inputClosed && state.inputStarted) {
            controller.enqueue({
              type: 'tool-input-end',
              id: toolId,
            });
            state.inputClosed = true;
          }
        };

        const emitToolCall = (toolId: string, state: ToolStreamState) => {
          if (state.callEmitted) {
            return;
          }

          closeToolInput(toolId, state);

          controller.enqueue({
            type: 'tool-call',
            toolCallId: toolId,
            toolName: state.name,
            input: state.lastSerializedInput ?? '',
            providerExecuted: true,
            dynamic: true, // V3 field: indicates tool is provider-defined (not in user's tools map)
            providerMetadata: {
              'claude-code': {
                // rawInput preserves the original serialized format before AI SDK normalization.
                // Use this if you need the exact string sent to the Claude CLI, which may differ
                // from the `input` field after AI SDK processing.
                rawInput: state.lastSerializedInput ?? '',
                parentToolCallId: state.parentToolCallId ?? null,
              },
            },
          } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
          state.callEmitted = true;
        };

        const finalizeToolCalls = () => {
          for (const [toolId, state] of toolStates) {
            emitToolCall(toolId, state);
          }
          toolStates.clear();
        };

        let usage: LanguageModelV3Usage = createEmptyUsage();
        let accumulatedText = '';
        let textPartId: string | undefined;
        let streamedTextLength = 0; // Track text already emitted via stream_events to avoid duplication
        let hasReceivedStreamEvents = false; // Track if we've received any stream_events
        let hasStreamedJson = false; // Track if JSON has been streamed via input_json_delta

        // Content block streaming: Map block indices to tool IDs and accumulated JSON
        const toolBlocksByIndex = new Map<number, string>();
        const toolInputAccumulators = new Map<string, string>();

        // Track text content blocks by index for correlating text_delta with text parts
        const textBlocksByIndex = new Map<number, string>();

        // Track if text was streamed via content blocks to prevent double emission in result handler
        let textStreamedViaContentBlock = false;

        // Extended thinking: Map block indices to reasoning part IDs
        const reasoningBlocksByIndex = new Map<number, string>();
        let currentReasoningPartId: string | undefined;

        try {
          // Emit stream-start with warnings
          controller.enqueue({ type: 'stream-start', warnings });

          if (effectiveCanUseTool && effectivePermissionPromptToolName) {
            throw new Error(
              "canUseTool requires streamingInput mode ('auto' or 'always') and cannot be used with permissionPromptToolName (SDK constraint). Set streamingInput: 'auto' (or 'always') and remove permissionPromptToolName, or remove canUseTool."
            );
          }
          // hold input stream open until results
          // see: https://github.com/anthropics/claude-code/issues/4775
          const sdkPrompt = wantsStreamInput
            ? toAsyncIterablePrompt(
                messagesPrompt,
                outputStreamEnded,
                effectiveResume,
                streamingContentParts,
                this.settings.onStreamStart
              )
            : messagesPrompt;

          this.logger.debug(
            `[claude-code] Starting stream query with streamingInput: ${wantsStreamInput}, session: ${effectiveResume ?? 'new'}`
          );

          const response = query({
            prompt: sdkPrompt,
            options: queryOptions,
          });

          // Invoke onQueryCreated callback to expose Query object for advanced features
          // like mid-stream message injection via query.streamInput()
          this.settings.onQueryCreated?.(response);

          for await (const message of response) {
            this.logger.debug(`[claude-code] Stream received message type: ${message.type}`);

            // Handle streaming events (token-by-token delivery via includePartialMessages)
            if (message.type === 'stream_event') {
              const streamEvent = message as SDKPartialAssistantMessage;
              const event = streamEvent.event;

              // Check for text_delta events within content_block_delta
              if (
                event.type === 'content_block_delta' &&
                event.delta.type === 'text_delta' &&
                'text' in event.delta &&
                event.delta.text
              ) {
                const deltaText = event.delta.text;
                hasReceivedStreamEvents = true;

                // Don't emit text deltas in JSON mode - accumulate instead
                if (options.responseFormat?.type === 'json') {
                  accumulatedText += deltaText;
                  streamedTextLength += deltaText.length;
                  continue;
                }

                // Emit text-start if this is the first text
                if (!textPartId) {
                  textPartId = generateId();
                  controller.enqueue({
                    type: 'text-start',
                    id: textPartId,
                  });
                }

                controller.enqueue({
                  type: 'text-delta',
                  id: textPartId,
                  delta: deltaText,
                });
                accumulatedText += deltaText;
                streamedTextLength += deltaText.length;
              }
              // Handle input_json_delta events for structured output streaming
              // The SDK uses a StructuredOutput tool internally, and JSON is streamed via input_json_delta
              if (
                event.type === 'content_block_delta' &&
                event.delta.type === 'input_json_delta' &&
                'partial_json' in event.delta &&
                event.delta.partial_json
              ) {
                const jsonDelta = event.delta.partial_json;
                hasReceivedStreamEvents = true;
                const blockIndex = 'index' in event ? (event.index as number) : -1;

                // In JSON mode, prioritize streaming to text-delta for streamObject() support
                // The SDK's internal StructuredOutput tool uses input_json_delta to stream JSON responses
                if (options.responseFormat?.type === 'json') {
                  // Emit text-start if this is the first JSON delta
                  if (!textPartId) {
                    textPartId = generateId();
                    controller.enqueue({
                      type: 'text-start',
                      id: textPartId,
                    });
                  }

                  controller.enqueue({
                    type: 'text-delta',
                    id: textPartId,
                    delta: jsonDelta,
                  });
                  accumulatedText += jsonDelta;
                  streamedTextLength += jsonDelta.length;
                  hasStreamedJson = true;
                  continue;
                }

                // In non-JSON mode, route to tool-input-delta if we have a tracked tool
                const toolId = toolBlocksByIndex.get(blockIndex);
                if (toolId) {
                  // Accumulate and emit tool-input-delta
                  const accumulated = (toolInputAccumulators.get(toolId) ?? '') + jsonDelta;
                  toolInputAccumulators.set(toolId, accumulated);

                  controller.enqueue({
                    type: 'tool-input-delta',
                    id: toolId,
                    delta: jsonDelta,
                  });
                  continue;
                }
                // input_json_delta without tool context in non-JSON mode is ignored
              }

              // Handle content_block_start for tool_use - emit tool-input-start immediately
              if (
                event.type === 'content_block_start' &&
                'content_block' in event &&
                event.content_block?.type === 'tool_use'
              ) {
                const blockIndex = 'index' in event ? (event.index as number) : -1;
                const toolBlock = event.content_block as {
                  type: string;
                  id?: string;
                  name?: string;
                };
                const toolId =
                  typeof toolBlock.id === 'string' && toolBlock.id.length > 0
                    ? toolBlock.id
                    : generateId();
                const toolName =
                  typeof toolBlock.name === 'string' && toolBlock.name.length > 0
                    ? toolBlock.name
                    : ClaudeCodeLanguageModel.UNKNOWN_TOOL_NAME;

                hasReceivedStreamEvents = true;

                // Close any active text part before tool starts
                if (textPartId) {
                  controller.enqueue({
                    type: 'text-end',
                    id: textPartId,
                  });
                  textPartId = undefined;
                }

                // Track this block for later delta/stop events
                toolBlocksByIndex.set(blockIndex, toolId);
                toolInputAccumulators.set(toolId, '');

                // Create tool state if not exists
                let state = toolStates.get(toolId);
                if (!state) {
                  // Use timing-based inference for parent (Task tools are top-level)
                  const currentParentId = toolName === 'Task' ? null : getFallbackParentId();
                  state = {
                    name: toolName,
                    inputStarted: false,
                    inputClosed: false,
                    callEmitted: false,
                    parentToolCallId: currentParentId,
                  };
                  toolStates.set(toolId, state);
                }

                // Emit tool-input-start immediately with providerMetadata for parent context
                if (!state.inputStarted) {
                  this.logger.debug(
                    `[claude-code] Tool input started (content_block) - Tool: ${toolName}, ID: ${toolId}, parent: ${state.parentToolCallId}`
                  );
                  controller.enqueue({
                    type: 'tool-input-start',
                    id: toolId,
                    toolName,
                    providerExecuted: true,
                    dynamic: true,
                    providerMetadata: {
                      'claude-code': {
                        parentToolCallId: state.parentToolCallId ?? null,
                      },
                    },
                  } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

                  // Track Task tools as active so nested tools can reference them as parent
                  if (toolName === 'Task') {
                    activeTaskTools.set(toolId, { startTime: Date.now() });
                  }
                  state.inputStarted = true;
                }
                continue;
              }

              // Handle content_block_start for text - emit text-start early
              if (
                event.type === 'content_block_start' &&
                'content_block' in event &&
                event.content_block?.type === 'text'
              ) {
                const blockIndex = 'index' in event ? (event.index as number) : -1;
                hasReceivedStreamEvents = true;

                // Generate text part ID early and map to block index
                const partId = generateId();
                textBlocksByIndex.set(blockIndex, partId);
                textPartId = partId;

                this.logger.debug(
                  `[claude-code] Text content block started - Index: ${blockIndex}, ID: ${partId}`
                );

                controller.enqueue({
                  type: 'text-start',
                  id: partId,
                });
                textStreamedViaContentBlock = true;
                continue;
              }

              // Handle content_block_start for thinking - emit reasoning-start immediately
              if (
                event.type === 'content_block_start' &&
                'content_block' in event &&
                event.content_block?.type === 'thinking'
              ) {
                const blockIndex = 'index' in event ? (event.index as number) : -1;
                hasReceivedStreamEvents = true;

                // Close any active text part before reasoning starts
                if (textPartId) {
                  controller.enqueue({
                    type: 'text-end',
                    id: textPartId,
                  });
                  textPartId = undefined;
                }

                const reasoningPartId = generateId();
                reasoningBlocksByIndex.set(blockIndex, reasoningPartId);
                currentReasoningPartId = reasoningPartId;

                this.logger.debug(
                  `[claude-code] Reasoning started (content_block) - ID: ${reasoningPartId}`
                );
                controller.enqueue({
                  type: 'reasoning-start',
                  id: reasoningPartId,
                });
                continue;
              }

              // Handle thinking_delta for extended thinking
              if (
                event.type === 'content_block_delta' &&
                event.delta.type === 'thinking_delta' &&
                'thinking' in event.delta &&
                event.delta.thinking
              ) {
                const blockIndex = 'index' in event ? (event.index as number) : -1;
                const reasoningPartId =
                  reasoningBlocksByIndex.get(blockIndex) ?? currentReasoningPartId;
                hasReceivedStreamEvents = true;

                if (reasoningPartId) {
                  controller.enqueue({
                    type: 'reasoning-delta',
                    id: reasoningPartId,
                    delta: event.delta.thinking,
                  });
                }
                continue;
              }

              // Handle content_block_stop - finalize tool input, text, or reasoning
              if (event.type === 'content_block_stop') {
                const blockIndex = 'index' in event ? (event.index as number) : -1;
                hasReceivedStreamEvents = true;

                // Check if this is a tool block
                const toolId = toolBlocksByIndex.get(blockIndex);
                if (toolId) {
                  const state = toolStates.get(toolId);
                  if (state && !state.inputClosed) {
                    const accumulatedInput = toolInputAccumulators.get(toolId) ?? '';
                    this.logger.debug(
                      `[claude-code] Tool content block stopped - Index: ${blockIndex}, Tool: ${state.name}, ID: ${toolId}`
                    );
                    controller.enqueue({
                      type: 'tool-input-end',
                      id: toolId,
                    });
                    state.inputClosed = true;
                    const effectiveInput = accumulatedInput || state.lastSerializedInput || '';
                    state.lastSerializedInput = effectiveInput;

                    // Emit tool-call immediately when input is complete (don't wait for result)
                    // This allows UI to show "running" state while tool executes
                    if (!state.callEmitted) {
                      controller.enqueue({
                        type: 'tool-call',
                        toolCallId: toolId,
                        toolName: state.name,
                        input: effectiveInput,
                        providerExecuted: true,
                        dynamic: true,
                        providerMetadata: {
                          'claude-code': {
                            rawInput: effectiveInput,
                            parentToolCallId: state.parentToolCallId ?? null,
                          },
                        },
                      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
                      state.callEmitted = true;
                    }
                  }
                  toolBlocksByIndex.delete(blockIndex);
                  toolInputAccumulators.delete(toolId);
                  continue;
                }

                // Check if this is a text block
                const textId = textBlocksByIndex.get(blockIndex);
                if (textId) {
                  this.logger.debug(
                    `[claude-code] Text content block stopped - Index: ${blockIndex}, ID: ${textId}`
                  );
                  controller.enqueue({
                    type: 'text-end',
                    id: textId,
                  });
                  textBlocksByIndex.delete(blockIndex);
                  if (textPartId === textId) {
                    textPartId = undefined;
                  }
                  continue;
                }

                // Check if this is a reasoning block
                const reasoningPartId = reasoningBlocksByIndex.get(blockIndex);
                if (reasoningPartId) {
                  this.logger.debug(
                    `[claude-code] Reasoning ended (content_block) - ID: ${reasoningPartId}`
                  );
                  controller.enqueue({
                    type: 'reasoning-end',
                    id: reasoningPartId,
                  });
                  reasoningBlocksByIndex.delete(blockIndex);
                  if (currentReasoningPartId === reasoningPartId) {
                    currentReasoningPartId = undefined;
                  }
                  continue;
                }
              }

              // Other stream_event types are informational
              continue;
            }

            if (message.type === 'assistant') {
              if (!message.message?.content) {
                this.logger.warn(
                  `[claude-code] Unexpected assistant message structure: missing content field. Message type: ${message.type}. This may indicate an SDK protocol violation.`
                );
                continue;
              }

              // Extract parent_tool_use_id from SDK message - this is the authoritative source
              // SDK provides this field when tool is executed within a subagent context
              const sdkParentToolUseId = (message as { parent_tool_use_id?: string })
                .parent_tool_use_id;

              const content = message.message.content;
              const tools = this.extractToolUses(content);

              // Close any active text part before tool calls start.
              // This ensures tool calls split text into separate parts.
              // We only do this if there are actual tools to avoid unnecessary text-end events.
              if (textPartId && tools.length > 0) {
                controller.enqueue({
                  type: 'text-end',
                  id: textPartId,
                });
                textPartId = undefined; // Reset so next text gets a new ID
              }

              for (const tool of tools) {
                const toolId = tool.id;
                let state = toolStates.get(toolId);
                if (!state) {
                  // Prefer SDK message-level parent (works for parallel agents)
                  // Fall back to content-level parent, then timing-based inference
                  // Task tools never have a parent (they're top-level)
                  const currentParentId =
                    tool.name === 'Task'
                      ? null
                      : (sdkParentToolUseId ?? tool.parentToolUseId ?? getFallbackParentId());
                  state = {
                    name: tool.name,
                    inputStarted: false,
                    inputClosed: false,
                    callEmitted: false,
                    parentToolCallId: currentParentId,
                  };
                  toolStates.set(toolId, state);
                  this.logger.debug(
                    `[claude-code] New tool use detected - Tool: ${tool.name}, ID: ${toolId}, SDK parent: ${sdkParentToolUseId}, resolved parent: ${currentParentId}`
                  );
                } else if (!state.parentToolCallId && sdkParentToolUseId && tool.name !== 'Task') {
                  // RETROACTIVE PARENT CONTEXT: Tool state was created by streaming events
                  // but we now have authoritative parent from SDK message - update state
                  state.parentToolCallId = sdkParentToolUseId;
                  this.logger.debug(
                    `[claude-code] Retroactive parent context - Tool: ${tool.name}, ID: ${toolId}, parent: ${sdkParentToolUseId}`
                  );
                }

                state.name = tool.name;

                if (!state.inputStarted) {
                  this.logger.debug(
                    `[claude-code] Tool input started - Tool: ${tool.name}, ID: ${toolId}`
                  );
                  controller.enqueue({
                    type: 'tool-input-start',
                    id: toolId,
                    toolName: tool.name,
                    providerExecuted: true,
                    dynamic: true, // V3 field: indicates tool is provider-defined
                    providerMetadata: {
                      'claude-code': {
                        parentToolCallId: state.parentToolCallId ?? null,
                      },
                    },
                  } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
                  // Track Task tools as active so nested tools can reference them as parent
                  if (tool.name === 'Task') {
                    activeTaskTools.set(toolId, { startTime: Date.now() });
                  }
                  state.inputStarted = true;
                }

                const serializedInput = this.serializeToolInput(tool.input);
                if (serializedInput) {
                  let deltaPayload = '';

                  // First input: emit full delta only if small enough
                  if (state.lastSerializedInput === undefined) {
                    if (serializedInput.length <= ClaudeCodeLanguageModel.MAX_DELTA_CALC_SIZE) {
                      deltaPayload = serializedInput;
                    }
                  } else if (
                    serializedInput.length <= ClaudeCodeLanguageModel.MAX_DELTA_CALC_SIZE &&
                    state.lastSerializedInput.length <=
                      ClaudeCodeLanguageModel.MAX_DELTA_CALC_SIZE &&
                    serializedInput.startsWith(state.lastSerializedInput)
                  ) {
                    deltaPayload = serializedInput.slice(state.lastSerializedInput.length);
                  } else if (serializedInput !== state.lastSerializedInput) {
                    // Non-prefix updates or large inputs - defer to the final tool-call payload
                    deltaPayload = '';
                  }

                  if (deltaPayload) {
                    controller.enqueue({
                      type: 'tool-input-delta',
                      id: toolId,
                      delta: deltaPayload,
                    });
                  }
                  state.lastSerializedInput = serializedInput;
                }
              }

              const text = content
                .map((c: { type: string; text?: string }) => (c.type === 'text' ? c.text : ''))
                .join('');

              if (text) {
                // When we've received stream_events, assistant messages contain cumulative text
                // that we've already emitted via stream_event deltas - skip duplicates
                // When no stream_events received, assistant messages contain incremental text
                if (hasReceivedStreamEvents) {
                  // Calculate delta: only emit text that wasn't already streamed via stream_events
                  const newTextStart = streamedTextLength;
                  const deltaText = text.length > newTextStart ? text.slice(newTextStart) : '';

                  // Always accumulate for final result tracking
                  accumulatedText = text; // Replace with full text (assistant msg contains full content)

                  // In JSON mode, we accumulate the text and extract JSON at the end
                  // Otherwise, stream any new text
                  if (options.responseFormat?.type !== 'json' && deltaText) {
                    // Emit text-start if this is the first text
                    if (!textPartId) {
                      textPartId = generateId();
                      controller.enqueue({
                        type: 'text-start',
                        id: textPartId,
                      });
                    }

                    controller.enqueue({
                      type: 'text-delta',
                      id: textPartId,
                      delta: deltaText,
                    });
                  }

                  // Update streamedTextLength to match what we now know is the full text
                  streamedTextLength = text.length;
                } else {
                  // No stream_events - assistant messages contain incremental text chunks
                  accumulatedText += text;

                  // In JSON mode, we accumulate the text and extract JSON at the end
                  // Otherwise, stream the text as it comes
                  if (options.responseFormat?.type !== 'json') {
                    // Emit text-start if this is the first text
                    if (!textPartId) {
                      textPartId = generateId();
                      controller.enqueue({
                        type: 'text-start',
                        id: textPartId,
                      });
                    }

                    controller.enqueue({
                      type: 'text-delta',
                      id: textPartId,
                      delta: text,
                    });
                  }
                }
              }
            } else if (message.type === 'user') {
              if (!message.message?.content) {
                this.logger.warn(
                  `[claude-code] Unexpected user message structure: missing content field. Message type: ${message.type}. This may indicate an SDK protocol violation.`
                );
                continue;
              }

              // A user message signals the end of the current assistant message.
              // Reset text state to ensure the next assistant message starts with a new text part.
              // This prevents text from different assistant messages from being merged together.
              if (textPartId) {
                const closedTextId = textPartId;
                controller.enqueue({
                  type: 'text-end',
                  id: closedTextId,
                });
                textPartId = undefined;
                // Prevent a later content_block_stop from closing the same text part twice.
                for (const [blockIndex, blockTextId] of textBlocksByIndex) {
                  if (blockTextId === closedTextId) {
                    textBlocksByIndex.delete(blockIndex);
                    break;
                  }
                }
                accumulatedText = '';
                streamedTextLength = 0;
                this.logger.debug('[claude-code] Closed text part due to user message');
              }

              // Extract parent_tool_use_id from SDK message for late-arriving tool results
              const sdkParentToolUseIdForResults = (message as { parent_tool_use_id?: string })
                .parent_tool_use_id;

              const content = message.message.content;
              for (const result of this.extractToolResults(content)) {
                let state = toolStates.get(result.id);
                const toolName =
                  result.name ?? state?.name ?? ClaudeCodeLanguageModel.UNKNOWN_TOOL_NAME;

                this.logger.debug(
                  `[claude-code] Tool result received - Tool: ${toolName}, ID: ${result.id}`
                );

                if (!state) {
                  this.logger.warn(
                    `[claude-code] Received tool result for unknown tool ID: ${result.id}`
                  );
                  // Use SDK parent if available, otherwise fall back to timing-based inference
                  const resolvedParentId =
                    toolName === 'Task'
                      ? null
                      : (sdkParentToolUseIdForResults ?? getFallbackParentId());
                  state = {
                    name: toolName,
                    inputStarted: false,
                    inputClosed: false,
                    callEmitted: false,
                    parentToolCallId: resolvedParentId,
                  };
                  toolStates.set(result.id, state);
                  // Synthesize input lifecycle to preserve ordering when no prior tool_use was seen
                  if (!state.inputStarted) {
                    controller.enqueue({
                      type: 'tool-input-start',
                      id: result.id,
                      toolName,
                      providerExecuted: true,
                      dynamic: true, // V3 field: indicates tool is provider-defined
                      providerMetadata: {
                        'claude-code': {
                          parentToolCallId: state.parentToolCallId ?? null,
                        },
                      },
                    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
                    state.inputStarted = true;
                  }
                  if (!state.inputClosed) {
                    controller.enqueue({
                      type: 'tool-input-end',
                      id: result.id,
                    });
                    state.inputClosed = true;
                  }
                }
                state.name = toolName;
                const normalizedResult = this.normalizeToolResult(result.result);
                const rawResult =
                  typeof result.result === 'string'
                    ? result.result
                    : (() => {
                        try {
                          return JSON.stringify(result.result);
                        } catch {
                          return String(result.result);
                        }
                      })();
                const maxToolResultSize = this.settings.maxToolResultSize;
                const truncatedResult = truncateToolResultForStream(
                  normalizedResult,
                  maxToolResultSize
                );
                const truncatedRawResult = truncateToolResultForStream(
                  rawResult,
                  maxToolResultSize
                ) as string;
                const rawResultTruncated = truncatedRawResult !== rawResult;

                emitToolCall(result.id, state);

                // Remove Task tools from active set when they complete
                if (toolName === 'Task') {
                  activeTaskTools.delete(result.id);
                }

                controller.enqueue({
                  type: 'tool-result',
                  toolCallId: result.id,
                  toolName,
                  result: truncatedResult,
                  isError: result.isError,
                  providerExecuted: true,
                  dynamic: true, // V3 field: indicates tool is provider-defined
                  providerMetadata: {
                    'claude-code': {
                      // rawResult preserves the original CLI output string before JSON parsing.
                      // Use this when you need the exact string returned by the tool, especially
                      // if the `result` field has been parsed/normalized and you need the original format.
                      rawResult: truncatedRawResult,
                      rawResultTruncated,
                      parentToolCallId: state.parentToolCallId ?? null,
                    },
                  },
                } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
              }
              // Handle tool errors
              for (const error of this.extractToolErrors(content)) {
                let state = toolStates.get(error.id);
                const toolName =
                  error.name ?? state?.name ?? ClaudeCodeLanguageModel.UNKNOWN_TOOL_NAME;

                this.logger.debug(
                  `[claude-code] Tool error received - Tool: ${toolName}, ID: ${error.id}`
                );

                if (!state) {
                  this.logger.warn(
                    `[claude-code] Received tool error for unknown tool ID: ${error.id}`
                  );
                  // Use SDK parent if available, otherwise fall back to timing-based inference
                  const errorResolvedParentId =
                    toolName === 'Task'
                      ? null
                      : (sdkParentToolUseIdForResults ?? getFallbackParentId());
                  state = {
                    name: toolName,
                    inputStarted: true,
                    inputClosed: true,
                    callEmitted: false,
                    parentToolCallId: errorResolvedParentId,
                  };
                  toolStates.set(error.id, state);
                }

                // Ensure tool-call is emitted before tool-error
                emitToolCall(error.id, state);

                // Remove Task tools from active set when they error
                if (toolName === 'Task') {
                  activeTaskTools.delete(error.id);
                }

                const rawError =
                  typeof error.error === 'string'
                    ? error.error
                    : typeof error.error === 'object' && error.error !== null
                      ? (() => {
                          try {
                            return JSON.stringify(error.error);
                          } catch {
                            return String(error.error);
                          }
                        })()
                      : String(error.error);

                controller.enqueue({
                  type: 'tool-error',
                  toolCallId: error.id,
                  toolName,
                  error: rawError,
                  providerExecuted: true,
                  dynamic: true, // V3 field: indicates tool is provider-defined
                  providerMetadata: {
                    'claude-code': {
                      rawError,
                      parentToolCallId: state.parentToolCallId ?? null,
                    },
                  },
                } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
              }
            } else if (message.type === 'result') {
              done();

              // Handle is_error flag in result message (e.g., auth failures)
              // The CLI returns successful JSON with is_error: true and error message in result field
              if ('is_error' in message && message.is_error === true) {
                const errorMessage =
                  'result' in message && typeof message.result === 'string'
                    ? message.result
                    : 'Claude Code CLI returned an error';
                throw Object.assign(new Error(errorMessage), { exitCode: 1 });
              }

              // Handle structured output errors (SDK 0.1.45+)
              // Use string comparison to support new SDK subtypes not yet in TypeScript definitions
              if ((message.subtype as string) === 'error_max_structured_output_retries') {
                throw new Error(
                  'Failed to generate valid structured output after maximum retries. The model could not produce a response matching the required schema.'
                );
              }

              this.logger.info(
                `[claude-code] Stream completed - Session: ${message.session_id}, Cost: $${message.total_cost_usd?.toFixed(4) ?? 'N/A'}, Duration: ${message.duration_ms ?? 'N/A'}ms`
              );

              if ('usage' in message) {
                usage = convertClaudeCodeUsage(message.usage);

                this.logger.debug(
                  `[claude-code] Stream token usage - Input: ${usage.inputTokens.total}, Output: ${usage.outputTokens.total}`
                );
              }

              const stopReason =
                'stop_reason' in message
                  ? ((message as Record<string, unknown>).stop_reason as string | null | undefined)
                  : undefined;
              const finishReason: LanguageModelV3FinishReason = mapClaudeCodeFinishReason(
                message.subtype,
                stopReason
              );

              this.logger.debug(`[claude-code] Stream finish reason: ${finishReason.unified}`);

              // Store session ID in the model instance
              this.setSessionId(message.session_id);

              // Use structured output from SDK if available (native JSON schema support)
              const structuredOutput =
                'structured_output' in message ? message.structured_output : undefined;

              // Check if we've already streamed JSON via input_json_delta
              const alreadyStreamedJson =
                hasStreamedJson &&
                options.responseFormat?.type === 'json' &&
                hasReceivedStreamEvents;

              if (alreadyStreamedJson) {
                // We've already streamed JSON deltas; only close the text part if it's still open.
                if (textPartId) {
                  controller.enqueue({
                    type: 'text-end',
                    id: textPartId,
                  });
                }
              } else if (structuredOutput !== undefined) {
                // Emit structured output as text (fallback when streaming didn't occur)
                const jsonTextId = generateId();
                const jsonText = JSON.stringify(structuredOutput);
                controller.enqueue({
                  type: 'text-start',
                  id: jsonTextId,
                });
                controller.enqueue({
                  type: 'text-delta',
                  id: jsonTextId,
                  delta: jsonText,
                });
                controller.enqueue({
                  type: 'text-end',
                  id: jsonTextId,
                });
              } else if (textPartId) {
                // Close the text part if it was opened (non-JSON mode)
                controller.enqueue({
                  type: 'text-end',
                  id: textPartId,
                });
              } else if (accumulatedText && !textStreamedViaContentBlock) {
                // Fallback for JSON mode without schema: emit accumulated text
                // This handles the case where responseFormat.type === 'json' but no schema
                // was provided, so the SDK returns plain text instead of structured_output
                const fallbackTextId = generateId();
                controller.enqueue({
                  type: 'text-start',
                  id: fallbackTextId,
                });
                controller.enqueue({
                  type: 'text-delta',
                  id: fallbackTextId,
                  delta: accumulatedText,
                });
                controller.enqueue({
                  type: 'text-end',
                  id: fallbackTextId,
                });
              }

              finalizeToolCalls();

              // Prepare JSON-safe warnings for provider metadata
              const warningsJson = this.serializeWarningsForMetadata(streamWarnings);

              controller.enqueue({
                type: 'finish',
                finishReason,
                usage,
                providerMetadata: {
                  'claude-code': {
                    sessionId: message.session_id,
                    ...(message.total_cost_usd !== undefined && {
                      costUsd: message.total_cost_usd,
                    }),
                    ...(message.duration_ms !== undefined && { durationMs: message.duration_ms }),
                    ...(message.modelUsage !== undefined && {
                      modelUsage: message.modelUsage as unknown as JSONValue,
                    }),
                    // JSON validation warnings are collected during streaming and included
                    // in providerMetadata since the AI SDK's finish event doesn't support
                    // a top-level warnings field (unlike stream-start which was already emitted)
                    ...(streamWarnings.length > 0 && {
                      warnings: warningsJson as unknown as JSONValue,
                    }),
                  },
                },
              });
              controller.close();
              return;
            } else if (message.type === 'system' && message.subtype === 'init') {
              this.logMcpConnectionIssues(message.mcp_servers);

              // Store session ID for future use
              this.setSessionId(message.session_id);

              this.logger.info(`[claude-code] Stream session initialized: ${message.session_id}`);

              // Emit response metadata when session is initialized
              controller.enqueue({
                type: 'response-metadata',
                id: message.session_id,
                timestamp: new Date(),
                modelId: this.modelId,
              });
            }
          }

          finalizeToolCalls();
          this.logger.debug('[claude-code] Stream finalized, closing stream');
          controller.close();
        } catch (error: unknown) {
          done();

          this.logger.debug(
            `[claude-code] Error during doStream: ${error instanceof Error ? error.message : String(error)}`
          );

          if (isClaudeCodeTruncationError(error, accumulatedText)) {
            this.logger.warn(
              `[claude-code] Detected truncated stream response, returning ${accumulatedText.length} characters of buffered text`
            );
            const truncationWarning: SharedV3Warning = {
              type: 'other',
              message: CLAUDE_CODE_TRUNCATION_WARNING,
            };
            streamWarnings.push(truncationWarning);

            if (textPartId) {
              controller.enqueue({
                type: 'text-end',
                id: textPartId,
              });
            } else if (accumulatedText && !textStreamedViaContentBlock) {
              const fallbackTextId = generateId();
              controller.enqueue({
                type: 'text-start',
                id: fallbackTextId,
              });
              controller.enqueue({
                type: 'text-delta',
                id: fallbackTextId,
                delta: accumulatedText,
              });
              controller.enqueue({
                type: 'text-end',
                id: fallbackTextId,
              });
            }

            finalizeToolCalls();

            const warningsJson = this.serializeWarningsForMetadata(streamWarnings);

            controller.enqueue({
              type: 'finish',
              finishReason: { unified: 'length', raw: 'truncation' },
              usage,
              providerMetadata: {
                'claude-code': {
                  ...(this.sessionId !== undefined && { sessionId: this.sessionId }),
                  truncated: true,
                  ...(streamWarnings.length > 0 && {
                    warnings: warningsJson as unknown as JSONValue,
                  }),
                },
              },
            });

            controller.close();
            return;
          }

          finalizeToolCalls();
          let errorToEmit: unknown;

          // Special handling for AbortError to preserve abort signal reason
          if (isAbortError(error)) {
            errorToEmit = options.abortSignal?.aborted ? options.abortSignal.reason : error;
          } else {
            // Use unified error handler
            errorToEmit = this.handleClaudeCodeError(error, messagesPrompt, collectedStderr);
          }

          // Emit error as a stream part
          controller.enqueue({
            type: 'error',
            error: errorToEmit,
          });

          controller.close();
        } finally {
          if (options.abortSignal && abortListener) {
            options.abortSignal.removeEventListener('abort', abortListener);
          }
        }
      },
      cancel: () => {
        if (options.abortSignal && abortListener) {
          options.abortSignal.removeEventListener('abort', abortListener);
        }
      },
    });

    return {
      stream: stream as unknown as ReadableStream<LanguageModelV3StreamPart>,
      request: {
        body: messagesPrompt,
      },
    };
  }

  private serializeWarningsForMetadata(warnings: SharedV3Warning[]): JSONValue {
    const result = warnings.map((w) => {
      const base: Record<string, string> = { type: w.type };
      if ('message' in w) {
        const m = (w as { message?: unknown }).message;
        if (m !== undefined) base.message = String(m);
      }
      if (w.type === 'unsupported' || w.type === 'compatibility') {
        const feature = (w as { feature: unknown }).feature;
        if (feature !== undefined) base.feature = String(feature);
        if ('details' in w) {
          const d = (w as { details?: unknown }).details;
          if (d !== undefined) base.details = String(d);
        }
      }
      return base;
    });
    return result as unknown as JSONValue;
  }
}
