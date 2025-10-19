import type {
  LanguageModelV2,
  LanguageModelV2CallWarning,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
  JSONValue,
} from '@ai-sdk/provider';
import {
  NoSuchModelError,
  APICallError,
  LoadAPIKeyError,
} from '@ai-sdk/provider';
import { generateId } from '@ai-sdk/provider-utils';
import type { ClaudeCodeSettings, Logger } from './types.js';
import { convertToClaudeCodeMessages } from './convert-to-claude-code-messages.js';
import { extractJson } from './extract-json.js';
import {
  createAPICallError,
  createAuthenticationError,
  createTimeoutError,
} from './errors.js';
import { mapClaudeCodeFinishReason } from './map-claude-code-finish-reason.js';
import {
  validateModelId,
  validatePrompt,
  validateSessionId,
} from './validation.js';
import { getLogger } from './logger.js';

import { query, type Options } from '@anthropic-ai/claude-code';
import type { SDKUserMessage } from '@anthropic-ai/claude-code';

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
function isClaudeCodeTruncationError(
  error: unknown,
  bufferedText: string
): boolean {
  // Check for SyntaxError by instanceof or by name (for cross-realm errors)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  const rawMessage =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (error as any)?.message === 'string' ? (error as any).message : '';
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
    if (typeof e.code === 'string' && e.code.toUpperCase() === 'ABORT_ERR')
      return true;
  }
  return false;
}

const STREAMING_FEATURE_WARNING =
  "Claude Code SDK features (hooks/MCP/images) require streaming input. Set `streamingInput: 'always'` or provide `canUseTool` (auto streams only when canUseTool is set).";

type ClaudeToolUse = {
  id: string;
  name: string;
  input: unknown;
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
type ExtendedStreamPart = LanguageModelV2StreamPart | ToolErrorPart;

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
};

function toAsyncIterablePrompt(
  messagesPrompt: string,
  outputStreamEnded: Promise<unknown>,
  sessionId?: string,
  contentParts?: SDKUserMessage['message']['content']
): AsyncIterable<SDKUserMessage> {
  const content = (
    contentParts && contentParts.length > 0
      ? contentParts
      : [{ type: 'text', text: messagesPrompt }]
  ) as SDKUserMessage['message']['content'];

  const msg: SDKUserMessage = {
    type: 'user',
    message: {
      role: 'user',
      content,
    },
    parent_tool_use_id: null,
    session_id: sessionId ?? '',
  };
  return {
    async *[Symbol.asyncIterator]() {
      yield msg;
      await outputStreamEnded;
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
   * Can be 'opus', 'sonnet', or a custom model string.
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
 * - 'opus': Claude 4 Opus model (most capable)
 * - 'sonnet': Claude 4 Sonnet model (balanced performance)
 * - Custom string: Any other model identifier supported by the CLI
 *
 * @example
 * ```typescript
 * const opusModel = claudeCode('opus');
 * const sonnetModel = claudeCode('sonnet');
 * const customModel = claudeCode('claude-3-opus-20240229');
 * ```
 */
export type ClaudeCodeModelId = 'opus' | 'sonnet' | (string & {});

const modelMap: Record<string, string> = {
  opus: 'opus',
  sonnet: 'sonnet',
};

/**
 * Language model implementation for Claude Code SDK.
 * This class implements the AI SDK's LanguageModelV1 interface to provide
 * integration with Claude models through the Claude Code SDK.
 *
 * Features:
 * - Supports streaming and non-streaming generation
 * - Handles JSON object generation mode
 * - Manages CLI sessions for conversation continuity
 * - Provides detailed error handling and retry logic
 *
 * Limitations:
 * - Image inputs require streaming mode
 * - Does not support structured outputs (tool mode)
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
export class ClaudeCodeLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = 'v2' as const;
  readonly defaultObjectGenerationMode = 'json' as const;
  readonly supportsImageUrls = false;
  readonly supportedUrls = {};
  readonly supportsStructuredOutputs = false;

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
    this.logger = getLogger(this.settings.logger);

    // Validate model ID format
    if (
      !this.modelId ||
      typeof this.modelId !== 'string' ||
      this.modelId.trim() === ''
    ) {
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

  private extractToolUses(content: unknown): ClaudeToolUse[] {
    if (!Array.isArray(content)) {
      return [];
    }

    return content
      .filter(
        (
          item
        ): item is {
          type: string;
          id?: unknown;
          name?: unknown;
          input?: unknown;
        } =>
          typeof item === 'object' &&
          item !== null &&
          'type' in item &&
          (item as { type: unknown }).type === 'tool_use'
      )
      .map((item) => {
        const { id, name, input } = item as {
          id?: unknown;
          name?: unknown;
          input?: unknown;
        };
        return {
          id: typeof id === 'string' && id.length > 0 ? id : generateId(),
          name:
            typeof name === 'string' && name.length > 0
              ? name
              : ClaudeCodeLanguageModel.UNKNOWN_TOOL_NAME,
          input,
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
            typeof tool_use_id === 'string' && tool_use_id.length > 0
              ? tool_use_id
              : generateId(),
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
            typeof tool_use_id === 'string' && tool_use_id.length > 0
              ? tool_use_id
              : generateId(),
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
      console.warn(
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

    return result;
  }

  private generateAllWarnings(
    options:
      | Parameters<LanguageModelV2['doGenerate']>[0]
      | Parameters<LanguageModelV2['doStream']>[0],
    prompt: string
  ): LanguageModelV2CallWarning[] {
    const warnings: LanguageModelV2CallWarning[] = [];
    const unsupportedParams: string[] = [];

    // Check for unsupported parameters
    if (options.temperature !== undefined)
      unsupportedParams.push('temperature');
    if (options.topP !== undefined) unsupportedParams.push('topP');
    if (options.topK !== undefined) unsupportedParams.push('topK');
    if (options.presencePenalty !== undefined)
      unsupportedParams.push('presencePenalty');
    if (options.frequencyPenalty !== undefined)
      unsupportedParams.push('frequencyPenalty');
    if (options.stopSequences !== undefined && options.stopSequences.length > 0)
      unsupportedParams.push('stopSequences');
    if (options.seed !== undefined) unsupportedParams.push('seed');

    if (unsupportedParams.length > 0) {
      // Add a warning for each unsupported parameter
      for (const param of unsupportedParams) {
        warnings.push({
          type: 'unsupported-setting',
          setting: param as
            | 'temperature'
            | 'maxTokens'
            | 'topP'
            | 'topK'
            | 'presencePenalty'
            | 'frequencyPenalty'
            | 'stopSequences'
            | 'seed',
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

  private handleJsonExtraction(
    text: string,
    warnings: LanguageModelV2CallWarning[]
  ): string {
    const extracted = extractJson(text);
    const validation = this.validateJsonExtraction(text, extracted);

    if (!validation.valid && validation.warning) {
      warnings.push(validation.warning);
    }

    return extracted;
  }

  private createQueryOptions(abortController: AbortController): Options {
    const opts: Partial<Options> & Record<string, unknown> = {
      model: this.getModel(),
      abortController,
      resume: this.settings.resume ?? this.sessionId,
      pathToClaudeCodeExecutable: this.settings.pathToClaudeCodeExecutable,
      customSystemPrompt: this.settings.customSystemPrompt,
      appendSystemPrompt: this.settings.appendSystemPrompt,
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
      mcpServers: this.settings.mcpServers,
      canUseTool: this.settings.canUseTool,
    };
    // hooks is supported in newer SDKs; include it if provided
    if (this.settings.hooks) {
      opts.hooks = this.settings.hooks;
    }
    if (this.settings.env !== undefined) {
      opts.env = { ...process.env, ...this.settings.env };
    }
    return opts as Options;
  }

  private handleClaudeCodeError(
    error: unknown,
    messagesPrompt: string
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
    ];

    const errorMessage =
      isErrorWithMessage(error) && error.message
        ? error.message.toLowerCase()
        : '';

    const exitCode =
      isErrorWithCode(error) && typeof error.exitCode === 'number'
        ? error.exitCode
        : undefined;

    const isAuthError =
      authErrorPatterns.some((pattern) => errorMessage.includes(pattern)) ||
      exitCode === 401;

    if (isAuthError) {
      return createAuthenticationError({
        message:
          isErrorWithMessage(error) && error.message
            ? error.message
            : 'Authentication failed. Please ensure Claude Code SDK is properly authenticated.',
      });
    }

    // Check for timeout errors
    const errorCode =
      isErrorWithCode(error) && typeof error.code === 'string'
        ? error.code
        : '';

    if (errorCode === 'ETIMEDOUT' || errorMessage.includes('timeout')) {
      return createTimeoutError({
        message:
          isErrorWithMessage(error) && error.message
            ? error.message
            : 'Request timed out',
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

    return createAPICallError({
      message:
        isErrorWithMessage(error) && error.message
          ? error.message
          : 'Claude Code SDK error',
      code: errorCode || undefined,
      exitCode: exitCode,
      stderr:
        isErrorWithCode(error) && typeof error.stderr === 'string'
          ? error.stderr
          : undefined,
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

  private validateJsonExtraction(
    originalText: string,
    extractedJson: string
  ): { valid: boolean; warning?: LanguageModelV2CallWarning } {
    // If the extracted JSON is the same as original, extraction likely failed
    if (extractedJson === originalText) {
      return {
        valid: false,
        warning: {
          type: 'other',
          message:
            'JSON extraction from model response may be incomplete or modified. The model may not have returned valid JSON.',
        },
      };
    }

    // Try to parse the extracted JSON to validate it
    try {
      JSON.parse(extractedJson);
      return { valid: true };
    } catch {
      return {
        valid: false,
        warning: {
          type: 'other',
          message:
            'JSON extraction resulted in invalid JSON. The response may be malformed.',
        },
      };
    }
  }

  async doGenerate(
    options: Parameters<LanguageModelV2['doGenerate']>[0]
  ): Promise<Awaited<ReturnType<LanguageModelV2['doGenerate']>>> {
    // Determine mode based on responseFormat
    const mode =
      options.responseFormat?.type === 'json'
        ? { type: 'object-json' as const }
        : { type: 'regular' as const };

    const {
      messagesPrompt,
      warnings: messageWarnings,
      streamingContentParts,
      hasImageParts,
    } = convertToClaudeCodeMessages(
      options.prompt,
      mode,
      options.responseFormat?.type === 'json'
        ? options.responseFormat.schema
        : undefined
    );

    const abortController = new AbortController();
    let abortListener: (() => void) | undefined;
    if (options.abortSignal?.aborted) {
      // Propagate already-aborted state immediately with original reason
      abortController.abort(options.abortSignal.reason);
    } else if (options.abortSignal) {
      abortListener = () => abortController.abort(options.abortSignal?.reason);
      options.abortSignal.addEventListener('abort', abortListener, {
        once: true,
      });
    }

    const queryOptions = this.createQueryOptions(abortController);

    let text = '';
    let usage: LanguageModelV2Usage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
    let finishReason: LanguageModelV2FinishReason = 'stop';
    let costUsd: number | undefined;
    let durationMs: number | undefined;
    let rawUsage: unknown | undefined;
    let wasTruncated = false;
    const warnings: LanguageModelV2CallWarning[] = this.generateAllWarnings(
      options,
      messagesPrompt
    );

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
    const wantsStreamInput =
      modeSetting === 'always' ||
      (modeSetting === 'auto' && !!this.settings.canUseTool);

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
      if (this.settings.canUseTool && this.settings.permissionPromptToolName) {
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
            this.settings.resume ?? this.sessionId,
            streamingContentParts
          )
        : messagesPrompt;
      const response = query({
        prompt: sdkPrompt,
        options: queryOptions,
      });

      for await (const message of response) {
        if (message.type === 'assistant') {
          text += message.message.content
            .map((c: { type: string; text?: string }) =>
              c.type === 'text' ? c.text : ''
            )
            .join('');
        } else if (message.type === 'result') {
          done();
          this.setSessionId(message.session_id);
          costUsd = message.total_cost_usd;
          durationMs = message.duration_ms;

          if ('usage' in message) {
            rawUsage = message.usage;
            usage = {
              inputTokens:
                (message.usage.cache_creation_input_tokens ?? 0) +
                (message.usage.cache_read_input_tokens ?? 0) +
                (message.usage.input_tokens ?? 0),
              outputTokens: message.usage.output_tokens ?? 0,
              totalTokens:
                (message.usage.cache_creation_input_tokens ?? 0) +
                (message.usage.cache_read_input_tokens ?? 0) +
                (message.usage.input_tokens ?? 0) +
                (message.usage.output_tokens ?? 0),
            };
          }

          finishReason = mapClaudeCodeFinishReason(message.subtype);
        } else if (message.type === 'system' && message.subtype === 'init') {
          this.setSessionId(message.session_id);
        }
      }
    } catch (error: unknown) {
      done();
      // Special handling for AbortError to preserve abort signal reason
      if (isAbortError(error)) {
        throw options.abortSignal?.aborted ? options.abortSignal.reason : error;
      }

      // Check for CLI truncation before throwing
      if (isClaudeCodeTruncationError(error, text)) {
        wasTruncated = true;
        finishReason = 'length';
        warnings.push({
          type: 'other',
          message: CLAUDE_CODE_TRUNCATION_WARNING,
        });
        // Do not throw - return the buffered text
      } else {
        // Use unified error handler for genuine errors
        throw this.handleClaudeCodeError(error, messagesPrompt);
      }
    } finally {
      if (options.abortSignal && abortListener) {
        options.abortSignal.removeEventListener('abort', abortListener);
      }
    }

    // Extract JSON if responseFormat indicates JSON mode
    if (options.responseFormat?.type === 'json' && text) {
      text = this.handleJsonExtraction(text, warnings);
    }

    return {
      content: [{ type: 'text', text }],
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
          ...(rawUsage !== undefined && { rawUsage: rawUsage as JSONValue }),
          ...(wasTruncated && { truncated: true }),
        },
      },
    };
  }

  async doStream(
    options: Parameters<LanguageModelV2['doStream']>[0]
  ): Promise<Awaited<ReturnType<LanguageModelV2['doStream']>>> {
    // Determine mode based on responseFormat
    const mode =
      options.responseFormat?.type === 'json'
        ? { type: 'object-json' as const }
        : { type: 'regular' as const };

    const {
      messagesPrompt,
      warnings: messageWarnings,
      streamingContentParts,
      hasImageParts,
    } = convertToClaudeCodeMessages(
      options.prompt,
      mode,
      options.responseFormat?.type === 'json'
        ? options.responseFormat.schema
        : undefined
    );

    const abortController = new AbortController();
    let abortListener: (() => void) | undefined;
    if (options.abortSignal?.aborted) {
      // Propagate already-aborted state immediately with original reason
      abortController.abort(options.abortSignal.reason);
    } else if (options.abortSignal) {
      abortListener = () => abortController.abort(options.abortSignal?.reason);
      options.abortSignal.addEventListener('abort', abortListener, {
        once: true,
      });
    }

    const queryOptions = this.createQueryOptions(abortController);

    const warnings: LanguageModelV2CallWarning[] = this.generateAllWarnings(
      options,
      messagesPrompt
    );

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
    const wantsStreamInput =
      modeSetting === 'always' ||
      (modeSetting === 'auto' && !!this.settings.canUseTool);

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
        const streamWarnings: LanguageModelV2CallWarning[] = [];

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

        let usage: LanguageModelV2Usage = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        };
        let accumulatedText = '';
        let textPartId: string | undefined;

        try {
          // Emit stream-start with warnings
          controller.enqueue({ type: 'stream-start', warnings });

          if (
            this.settings.canUseTool &&
            this.settings.permissionPromptToolName
          ) {
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
                this.settings.resume ?? this.sessionId,
                streamingContentParts
              )
            : messagesPrompt;
          const response = query({
            prompt: sdkPrompt,
            options: queryOptions,
          });

          for await (const message of response) {
            if (message.type === 'assistant') {
              if (!message.message?.content) {
                console.warn(
                  `[claude-code] Unexpected assistant message structure: missing content field. Message type: ${message.type}. This may indicate an SDK protocol violation.`,
                  message
                );
                continue;
              }

              const content = message.message.content;

              for (const tool of this.extractToolUses(content)) {
                const toolId = tool.id;
                let state = toolStates.get(toolId);
                if (!state) {
                  state = {
                    name: tool.name,
                    inputStarted: false,
                    inputClosed: false,
                    callEmitted: false,
                  };
                  toolStates.set(toolId, state);
                }

                state.name = tool.name;

                if (!state.inputStarted) {
                  controller.enqueue({
                    type: 'tool-input-start',
                    id: toolId,
                    toolName: tool.name,
                    providerExecuted: true,
                    dynamic: true, // V3 field: indicates tool is provider-defined
                  } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
                  state.inputStarted = true;
                }

                const serializedInput = this.serializeToolInput(tool.input);
                if (serializedInput) {
                  let deltaPayload = '';

                  // First input: emit full delta only if small enough
                  if (state.lastSerializedInput === undefined) {
                    if (
                      serializedInput.length <=
                      ClaudeCodeLanguageModel.MAX_DELTA_CALC_SIZE
                    ) {
                      deltaPayload = serializedInput;
                    }
                  } else if (
                    serializedInput.length <=
                      ClaudeCodeLanguageModel.MAX_DELTA_CALC_SIZE &&
                    state.lastSerializedInput.length <=
                      ClaudeCodeLanguageModel.MAX_DELTA_CALC_SIZE &&
                    serializedInput.startsWith(state.lastSerializedInput)
                  ) {
                    deltaPayload = serializedInput.slice(
                      state.lastSerializedInput.length
                    );
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
                .map((c: { type: string; text?: string }) =>
                  c.type === 'text' ? c.text : ''
                )
                .join('');

              if (text) {
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
            } else if (message.type === 'user') {
              if (!message.message?.content) {
                console.warn(
                  `[claude-code] Unexpected user message structure: missing content field. Message type: ${message.type}. This may indicate an SDK protocol violation.`,
                  message
                );
                continue;
              }
              const content = message.message.content;
              for (const result of this.extractToolResults(content)) {
                let state = toolStates.get(result.id);
                const toolName =
                  result.name ??
                  state?.name ??
                  ClaudeCodeLanguageModel.UNKNOWN_TOOL_NAME;
                if (!state) {
                  console.warn(
                    `[claude-code] Received tool result for unknown tool ID: ${result.id}`
                  );
                  state = {
                    name: toolName,
                    inputStarted: false,
                    inputClosed: false,
                    callEmitted: false,
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
                const normalizedResult = this.normalizeToolResult(
                  result.result
                );
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

                emitToolCall(result.id, state);

                controller.enqueue({
                  type: 'tool-result',
                  toolCallId: result.id,
                  toolName,
                  result: normalizedResult,
                  isError: result.isError,
                  providerExecuted: true,
                  dynamic: true, // V3 field: indicates tool is provider-defined
                  providerMetadata: {
                    'claude-code': {
                      // rawResult preserves the original CLI output string before JSON parsing.
                      // Use this when you need the exact string returned by the tool, especially
                      // if the `result` field has been parsed/normalized and you need the original format.
                      rawResult,
                    },
                  },
                } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
              }
              // Handle tool errors
              for (const error of this.extractToolErrors(content)) {
                let state = toolStates.get(error.id);
                const toolName =
                  error.name ??
                  state?.name ??
                  ClaudeCodeLanguageModel.UNKNOWN_TOOL_NAME;

                if (!state) {
                  console.warn(
                    `[claude-code] Received tool error for unknown tool ID: ${error.id}`
                  );
                  state = {
                    name: toolName,
                    inputStarted: true,
                    inputClosed: true,
                    callEmitted: false,
                  };
                  toolStates.set(error.id, state);
                }

                // Ensure tool-call is emitted before tool-error
                emitToolCall(error.id, state);

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
                    },
                  },
                } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
              }
            } else if (message.type === 'result') {
              done();
              let rawUsage: unknown | undefined;
              if ('usage' in message) {
                rawUsage = message.usage;
                usage = {
                  inputTokens:
                    (message.usage.cache_creation_input_tokens ?? 0) +
                    (message.usage.cache_read_input_tokens ?? 0) +
                    (message.usage.input_tokens ?? 0),
                  outputTokens: message.usage.output_tokens ?? 0,
                  totalTokens:
                    (message.usage.cache_creation_input_tokens ?? 0) +
                    (message.usage.cache_read_input_tokens ?? 0) +
                    (message.usage.input_tokens ?? 0) +
                    (message.usage.output_tokens ?? 0),
                };
              }

              const finishReason: LanguageModelV2FinishReason =
                mapClaudeCodeFinishReason(message.subtype);

              // Store session ID in the model instance
              this.setSessionId(message.session_id);

              // Check if we need to extract JSON based on responseFormat
              if (options.responseFormat?.type === 'json' && accumulatedText) {
                const extractedJson = this.handleJsonExtraction(
                  accumulatedText,
                  streamWarnings
                );

                // Emit text-start/delta/end for JSON content
                const jsonTextId = generateId();
                controller.enqueue({
                  type: 'text-start',
                  id: jsonTextId,
                });
                controller.enqueue({
                  type: 'text-delta',
                  id: jsonTextId,
                  delta: extractedJson,
                });
                controller.enqueue({
                  type: 'text-end',
                  id: jsonTextId,
                });
              } else if (textPartId) {
                // Close the text part if it was opened
                controller.enqueue({
                  type: 'text-end',
                  id: textPartId,
                });
              }

              finalizeToolCalls();

              // Prepare JSON-safe warnings for provider metadata
              const warningsJson =
                this.serializeWarningsForMetadata(streamWarnings);

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
                    ...(message.duration_ms !== undefined && {
                      durationMs: message.duration_ms,
                    }),
                    ...(rawUsage !== undefined && {
                      rawUsage: rawUsage as JSONValue,
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
            } else if (
              message.type === 'system' &&
              message.subtype === 'init'
            ) {
              // Store session ID for future use
              this.setSessionId(message.session_id);

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
          controller.close();
        } catch (error: unknown) {
          done();

          if (isClaudeCodeTruncationError(error, accumulatedText)) {
            const truncationWarning: LanguageModelV2CallWarning = {
              type: 'other',
              message: CLAUDE_CODE_TRUNCATION_WARNING,
            };
            streamWarnings.push(truncationWarning);

            const emitJsonText = () => {
              const extractedJson = this.handleJsonExtraction(accumulatedText, streamWarnings);
              const jsonTextId = generateId();
              controller.enqueue({
                type: 'text-start',
                id: jsonTextId,
              });
              controller.enqueue({
                type: 'text-delta',
                id: jsonTextId,
                delta: extractedJson,
              });
              controller.enqueue({
                type: 'text-end',
                id: jsonTextId,
              });
            };

            if (options.responseFormat?.type === 'json') {
              emitJsonText();
            } else if (textPartId) {
              controller.enqueue({
                type: 'text-end',
                id: textPartId,
              });
            } else if (accumulatedText) {
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
              finishReason: 'length',
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
            errorToEmit = options.abortSignal?.aborted
              ? options.abortSignal.reason
              : error;
          } else {
            // Use unified error handler
            errorToEmit = this.handleClaudeCodeError(error, messagesPrompt);
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
      stream: stream as unknown as ReadableStream<LanguageModelV2StreamPart>,
      request: {
        body: messagesPrompt,
      },
    };
  }

  private serializeWarningsForMetadata(
    warnings: LanguageModelV2CallWarning[]
  ): JSONValue {
    const result = warnings.map((w) => {
      const base: Record<string, string> = { type: w.type };
      if ('message' in w) {
        const m = (w as { message?: unknown }).message;
        if (m !== undefined) base.message = String(m);
      }
      if (w.type === 'unsupported-setting') {
        const setting = (w as { setting: unknown }).setting;
        if (setting !== undefined) base.setting = String(setting);
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
