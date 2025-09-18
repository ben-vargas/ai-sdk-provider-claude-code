import type {
  LanguageModelV2,
  LanguageModelV2CallWarning,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
  JSONValue,
} from '@ai-sdk/provider';
import { NoSuchModelError, APICallError, LoadAPIKeyError } from '@ai-sdk/provider';
import { generateId } from '@ai-sdk/provider-utils';
import type { ClaudeCodeSettings, Logger } from './types.js';
import { convertToClaudeCodeMessages } from './convert-to-claude-code-messages.js';
import { extractJson } from './extract-json.js';
import { createAPICallError, createAuthenticationError, createTimeoutError } from './errors.js';
import { mapClaudeCodeFinishReason } from './map-claude-code-finish-reason.js';
import { validateModelId, validatePrompt, validateSessionId } from './validation.js';
import { getLogger } from './logger.js';

import { query, type Options } from '@anthropic-ai/claude-code';
import type { SDKUserMessage } from '@anthropic-ai/claude-code';

function isAbortError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown; code?: unknown };
    if (typeof e.name === 'string' && e.name === 'AbortError') return true;
    if (typeof e.code === 'string' && e.code.toUpperCase() === 'ABORT_ERR') return true;
  }
  return false;
}

const STREAMING_FEATURE_WARNING = "Claude Code SDK features (hooks/MCP/images) require streaming input. Set `streamingInput: 'always'` or provide `canUseTool` (auto streams only when canUseTool is set).";

function toAsyncIterablePrompt(
  messagesPrompt: string,
  outputStreamEnded: Promise<unknown>,
  sessionId?: string,
  contentParts?: SDKUserMessage['message']['content'],
): AsyncIterable<SDKUserMessage> {
  const content = (contentParts && contentParts.length > 0
    ? contentParts
    : [{ type: 'text', text: messagesPrompt }]) as SDKUserMessage['message']['content'];

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
  'opus': 'opus',
  'sonnet': 'sonnet',
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

  private generateAllWarnings(
    options: Parameters<LanguageModelV2['doGenerate']>[0] | Parameters<LanguageModelV2['doStream']>[0],
    prompt: string
  ): LanguageModelV2CallWarning[] {
    const warnings: LanguageModelV2CallWarning[] = [];
    const unsupportedParams: string[] = [];
    
    // Check for unsupported parameters
    if (options.temperature !== undefined) unsupportedParams.push('temperature');
    if (options.topP !== undefined) unsupportedParams.push('topP');
    if (options.topK !== undefined) unsupportedParams.push('topK');
    if (options.presencePenalty !== undefined) unsupportedParams.push('presencePenalty');
    if (options.frequencyPenalty !== undefined) unsupportedParams.push('frequencyPenalty');
    if (options.stopSequences !== undefined && options.stopSequences.length > 0) unsupportedParams.push('stopSequences');
    if (options.seed !== undefined) unsupportedParams.push('seed');
    
    if (unsupportedParams.length > 0) {
      // Add a warning for each unsupported parameter
      for (const param of unsupportedParams) {
        warnings.push({
          type: 'unsupported-setting',
          setting: param as 'temperature' | 'maxTokens' | 'topP' | 'topK' | 'presencePenalty' | 'frequencyPenalty' | 'stopSequences' | 'seed',
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
    this.settingsValidationWarnings.forEach(warning => {
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

    const isErrorWithCode = (err: unknown): err is { code?: string; exitCode?: number; stderr?: string } => {
      return typeof err === 'object' && err !== null;
    };

    // Check for authentication errors with improved detection
    const authErrorPatterns = [
      'not logged in',
      'authentication',
      'unauthorized',
      'auth failed',
      'please login',
      'claude login'
    ];
    
    const errorMessage = isErrorWithMessage(error) && error.message 
      ? error.message.toLowerCase() 
      : '';
    
    const exitCode = isErrorWithCode(error) && typeof error.exitCode === 'number' 
      ? error.exitCode 
      : undefined;
      
    const isAuthError = authErrorPatterns.some(pattern => errorMessage.includes(pattern)) ||
                       exitCode === 401;

    if (isAuthError) {
      return createAuthenticationError({
        message: isErrorWithMessage(error) && error.message 
          ? error.message 
          : 'Authentication failed. Please ensure Claude Code SDK is properly authenticated.',
      });
    }

    // Check for timeout errors
    const errorCode = isErrorWithCode(error) && typeof error.code === 'string' 
      ? error.code 
      : '';
      
    if (errorCode === 'ETIMEDOUT' || errorMessage.includes('timeout')) {
      return createTimeoutError({
        message: isErrorWithMessage(error) && error.message 
          ? error.message 
          : 'Request timed out',
        promptExcerpt: messagesPrompt.substring(0, 200),
        // Don't specify timeoutMs since we don't know the actual timeout value
        // It's controlled by the consumer via AbortSignal
      });
    }

    // Create general API call error with appropriate retry flag
    const isRetryable = errorCode === 'ENOENT' || 
                       errorCode === 'ECONNREFUSED' ||
                       errorCode === 'ETIMEDOUT' ||
                       errorCode === 'ECONNRESET';

    return createAPICallError({
      message: isErrorWithMessage(error) && error.message 
        ? error.message 
        : 'Claude Code SDK error',
      code: errorCode || undefined,
      exitCode: exitCode,
      stderr: isErrorWithCode(error) && typeof error.stderr === 'string' 
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
          message: 'JSON extraction from model response may be incomplete or modified. The model may not have returned valid JSON.',
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
          message: 'JSON extraction resulted in invalid JSON. The response may be malformed.',
        },
      };
    }
  }

  async doGenerate(
    options: Parameters<LanguageModelV2['doGenerate']>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV2['doGenerate']>>> {
    // Determine mode based on responseFormat
    const mode = options.responseFormat?.type === 'json' 
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
      options.responseFormat?.type === 'json' ? options.responseFormat.schema : undefined
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

    const queryOptions = this.createQueryOptions(abortController);

    let text = '';
    let usage: LanguageModelV2Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let finishReason: LanguageModelV2FinishReason = 'stop';
    let costUsd: number | undefined;
    let durationMs: number | undefined;
    let rawUsage: unknown | undefined;
    const warnings: LanguageModelV2CallWarning[] = this.generateAllWarnings(options, messagesPrompt);
    
    // Add warnings from message conversion
    if (messageWarnings) {
      messageWarnings.forEach(warning => {
        warnings.push({
          type: 'other',
          message: warning,
        });
      });
    }

    const modeSetting = this.settings.streamingInput ?? 'auto';
    const wantsStreamInput = modeSetting === 'always' || (modeSetting === 'auto' && !!this.settings.canUseTool);

    if (!wantsStreamInput && hasImageParts) {
      warnings.push({
        type: 'other',
        message: STREAMING_FEATURE_WARNING,
      });
    }

    let done = () => {};
    const outputStreamEnded = new Promise(resolve => { done = () => resolve(undefined); });
    try {
      if (this.settings.canUseTool && this.settings.permissionPromptToolName) {
        throw new Error("canUseTool requires streamingInput mode ('auto' or 'always') and cannot be used with permissionPromptToolName (SDK constraint). Set streamingInput: 'auto' (or 'always') and remove permissionPromptToolName, or remove canUseTool.");
      }
      // hold input stream open until results
      // see: https://github.com/anthropics/claude-code/issues/4775
      const sdkPrompt = wantsStreamInput
        ? toAsyncIterablePrompt(
            messagesPrompt,
            outputStreamEnded,
            this.settings.resume ?? this.sessionId,
            streamingContentParts,
          )
        : messagesPrompt;
      const response = query({
        prompt: sdkPrompt,
        options: queryOptions,
      });

      for await (const message of response) {
        if (message.type === 'assistant') {
          text += message.message.content.map((c: { type: string; text?: string }) => 
            c.type === 'text' ? c.text : ''
          ).join('');
        } else if (message.type === 'result') {
          done();
          this.setSessionId(message.session_id);
          costUsd = message.total_cost_usd;
          durationMs = message.duration_ms;
          
          if ('usage' in message) {
            rawUsage = message.usage;
            usage = {
              inputTokens: (message.usage.cache_creation_input_tokens ?? 0) + 
                           (message.usage.cache_read_input_tokens ?? 0) +
                           (message.usage.input_tokens ?? 0),
              outputTokens: message.usage.output_tokens ?? 0,
              totalTokens: (message.usage.cache_creation_input_tokens ?? 0) + 
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
      
      // Use unified error handler
      throw this.handleClaudeCodeError(error, messagesPrompt);
    } finally {
      if (options.abortSignal && abortListener) {
        options.abortSignal.removeEventListener('abort', abortListener);
      }
    }

    // Extract JSON if responseFormat indicates JSON mode
    if (options.responseFormat?.type === 'json' && text) {
      const extracted = extractJson(text);
      const validation = this.validateJsonExtraction(text, extracted);
      
      if (!validation.valid && validation.warning) {
        warnings.push(validation.warning);
      }
      
      text = extracted;
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
        },
      },
    };
  }

  async doStream(
    options: Parameters<LanguageModelV2['doStream']>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV2['doStream']>>> {
    // Determine mode based on responseFormat
    const mode = options.responseFormat?.type === 'json' 
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
      options.responseFormat?.type === 'json' ? options.responseFormat.schema : undefined
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

    const queryOptions = this.createQueryOptions(abortController);

    const warnings: LanguageModelV2CallWarning[] = this.generateAllWarnings(options, messagesPrompt);

    // Add warnings from message conversion
    if (messageWarnings) {
      messageWarnings.forEach(warning => {
        warnings.push({
          type: 'other',
          message: warning,
        });
      });
    }

    const modeSetting = this.settings.streamingInput ?? 'auto';
    const wantsStreamInput = modeSetting === 'always' || (modeSetting === 'auto' && !!this.settings.canUseTool);

    if (!wantsStreamInput && hasImageParts) {
      warnings.push({
        type: 'other',
        message: STREAMING_FEATURE_WARNING,
      });
    }

    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      start: async (controller) => {
        let done = () => {};
        const outputStreamEnded = new Promise(resolve => { done = () => resolve(undefined); });
        try {
          // Emit stream-start with warnings
          controller.enqueue({ type: 'stream-start', warnings });
          
          if (this.settings.canUseTool && this.settings.permissionPromptToolName) {
            throw new Error("canUseTool requires streamingInput mode ('auto' or 'always') and cannot be used with permissionPromptToolName (SDK constraint). Set streamingInput: 'auto' (or 'always') and remove permissionPromptToolName, or remove canUseTool.");
          }
          // hold input stream open until results
          // see: https://github.com/anthropics/claude-code/issues/4775
          const sdkPrompt = wantsStreamInput
            ? toAsyncIterablePrompt(
                messagesPrompt,
                outputStreamEnded,
                this.settings.resume ?? this.sessionId,
                streamingContentParts,
              )
            : messagesPrompt;
          const response = query({
            prompt: sdkPrompt,
            options: queryOptions,
          });

          let usage: LanguageModelV2Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
          let accumulatedText = '';
          let textPartId: string | undefined;

          for await (const message of response) {
            if (message.type === 'assistant') {
              const text = message.message.content
                .map((c: { type: string; text?: string }) => (c.type === 'text' ? c.text : ''))
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
            } else if (message.type === 'result') {
              done();
              let rawUsage: unknown | undefined;
              if ('usage' in message) {
                rawUsage = message.usage;
                usage = {
                  inputTokens: (message.usage.cache_creation_input_tokens ?? 0) + 
                               (message.usage.cache_read_input_tokens ?? 0) +
                               (message.usage.input_tokens ?? 0),
                  outputTokens: message.usage.output_tokens ?? 0,
                  totalTokens: (message.usage.cache_creation_input_tokens ?? 0) + 
                               (message.usage.cache_read_input_tokens ?? 0) +
                               (message.usage.input_tokens ?? 0) + 
                               (message.usage.output_tokens ?? 0),
                };
              }

              const finishReason: LanguageModelV2FinishReason = mapClaudeCodeFinishReason(message.subtype);

              // Store session ID in the model instance
              this.setSessionId(message.session_id);
              
              // Check if we need to extract JSON based on responseFormat
              if (options.responseFormat?.type === 'json' && accumulatedText) {
                const extractedJson = extractJson(accumulatedText);
                this.validateJsonExtraction(accumulatedText, extractedJson);
                
                // If validation failed, we should add a warning but we can't modify warnings array in stream
                // So we'll just send the extracted JSON anyway
                // In the future, we could emit a warning stream part if the SDK supports it
                
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
              
              controller.enqueue({
                type: 'finish',
                finishReason,
                usage,
                providerMetadata: {
                  'claude-code': {
                    sessionId: message.session_id,
                    ...(message.total_cost_usd !== undefined && { costUsd: message.total_cost_usd }),
                    ...(message.duration_ms !== undefined && { durationMs: message.duration_ms }),
                    ...(rawUsage !== undefined && { rawUsage: rawUsage as JSONValue }),
                  },
                },
              });
            } else if (message.type === 'system' && message.subtype === 'init') {
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

          controller.close();
        } catch (error: unknown) {
          done();
          let errorToEmit: unknown;
          
          // Special handling for AbortError to preserve abort signal reason
          if (isAbortError(error)) {
            errorToEmit = options.abortSignal?.aborted ? options.abortSignal.reason : error;
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
      stream,
      request: {
        body: messagesPrompt,
      },
    };
  }
}
