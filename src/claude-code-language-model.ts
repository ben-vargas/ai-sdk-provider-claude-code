import type {
  LanguageModelV1,
  LanguageModelV1CallWarning,
  LanguageModelV1FinishReason,
  LanguageModelV1StreamPart,
  JSONValue,
} from '@ai-sdk/provider';
import { NoSuchModelError, APICallError, LoadAPIKeyError } from '@ai-sdk/provider';
import { generateId } from '@ai-sdk/provider-utils';
import type { ClaudeCodeSettings } from './types.js';
import { convertToClaudeCodeMessages } from './convert-to-claude-code-messages.js';
import { extractJson } from './extract-json.js';
import { createAPICallError, createAuthenticationError, createTimeoutError } from './errors.js';

import { query, AbortError, type Options } from '@anthropic-ai/claude-code';

export interface ClaudeCodeLanguageModelOptions {
  id: ClaudeCodeModelId;
  settings?: ClaudeCodeSettings;
}

export type ClaudeCodeModelId = 'opus' | 'sonnet' | (string & {});

const modelMap: Record<string, string> = {
  'opus': 'opus',
  'sonnet': 'sonnet',
};

export class ClaudeCodeLanguageModel implements LanguageModelV1 {
  readonly specificationVersion = 'v1' as const;
  readonly defaultObjectGenerationMode = 'json' as const;
  readonly supportsImageUrls = false;
  readonly supportsStructuredOutputs = false;

  readonly modelId: ClaudeCodeModelId;
  readonly settings: ClaudeCodeSettings;
  
  private sessionId?: string;

  constructor(options: ClaudeCodeLanguageModelOptions) {
    this.modelId = options.id;
    this.settings = options.settings ?? {};
    
    // Validate model ID format
    if (!this.modelId || typeof this.modelId !== 'string' || this.modelId.trim() === '') {
      throw new NoSuchModelError({
        modelId: this.modelId,
        modelType: 'languageModel',
      });
    }
  }

  get provider(): string {
    return 'claude-code';
  }

  private getModel(): string {
    const mapped = modelMap[this.modelId];
    return mapped ?? this.modelId;
  }

  private generateUnsupportedWarnings(
    options: Parameters<LanguageModelV1['doGenerate']>[0] | Parameters<LanguageModelV1['doStream']>[0]
  ): LanguageModelV1CallWarning[] {
    const warnings: LanguageModelV1CallWarning[] = [];
    const unsupportedParams: string[] = [];
    
    // Check for unsupported parameters
    if (options.temperature !== undefined) unsupportedParams.push('temperature');
    if (options.maxTokens !== undefined) unsupportedParams.push('maxTokens');
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
          details: `Claude Code CLI does not support the ${param} parameter. It will be ignored.`,
        });
      }
    }
    
    return warnings;
  }

  private createQueryOptions(abortController: AbortController): Options {
    return {
      model: this.getModel(),
      abortController,
      resume: this.sessionId,
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
    };
  }

  private handleClaudeCodeError(
    error: unknown,
    messagesPrompt: string
  ): APICallError | LoadAPIKeyError {
    // Handle AbortError from the SDK
    if (error instanceof AbortError) {
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
          : 'Authentication failed. Please ensure Claude Code CLI is properly authenticated.',
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
        timeoutMs: 120000, // Default timeout, could be made configurable
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
        : 'Claude Code CLI error',
      code: errorCode || undefined,
      exitCode: exitCode,
      stderr: isErrorWithCode(error) && typeof error.stderr === 'string' 
        ? error.stderr 
        : undefined,
      promptExcerpt: messagesPrompt.substring(0, 200),
      isRetryable,
    });
  }

  private validateJsonExtraction(
    originalText: string,
    extractedJson: string
  ): { valid: boolean; warning?: LanguageModelV1CallWarning } {
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
    options: Parameters<LanguageModelV1['doGenerate']>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV1['doGenerate']>>> {
    const { messagesPrompt } = convertToClaudeCodeMessages(options.prompt, options.mode);

    const abortController = new AbortController();
    if (options.abortSignal) {
      options.abortSignal.addEventListener('abort', () => abortController.abort());
    }

    const queryOptions = this.createQueryOptions(abortController);

    let text = '';
    let usage = { promptTokens: 0, completionTokens: 0 };
    let finishReason: LanguageModelV1FinishReason = 'stop';
    let costUsd: number | undefined;
    let durationMs: number | undefined;
    let rawUsage: unknown | undefined;
    const warnings: LanguageModelV1CallWarning[] = this.generateUnsupportedWarnings(options);

    try {
      const response = query({
        prompt: messagesPrompt,
        options: queryOptions,
      });

      for await (const message of response) {
        if (message.type === 'assistant') {
          text += message.message.content.map((c: { type: string; text?: string }) => 
            c.type === 'text' ? c.text : ''
          ).join('');
        } else if (message.type === 'result') {
          this.sessionId = message.session_id;
          costUsd = message.total_cost_usd;
          durationMs = message.duration_ms;
          
          if ('usage' in message) {
            rawUsage = message.usage;
            usage = {
              promptTokens: (message.usage.cache_creation_input_tokens ?? 0) + 
                           (message.usage.cache_read_input_tokens ?? 0) +
                           (message.usage.input_tokens ?? 0),
              completionTokens: message.usage.output_tokens ?? 0,
            };
          }

          if (message.subtype === 'error_max_turns') {
            finishReason = 'length';
          } else if (message.subtype === 'error_during_execution') {
            finishReason = 'error';
          }
        } else if (message.type === 'system' && message.subtype === 'init') {
          this.sessionId = message.session_id;
        }
      }
    } catch (error: unknown) {
      // Special handling for AbortError to preserve abort signal reason
      if (error instanceof AbortError) {
        throw options.abortSignal?.aborted ? options.abortSignal.reason : error;
      }
      
      // Use unified error handler
      throw this.handleClaudeCodeError(error, messagesPrompt);
    }

    // Extract JSON if in object-json mode
    if (options.mode?.type === 'object-json' && text) {
      const extracted = extractJson(text);
      const validation = this.validateJsonExtraction(text, extracted);
      
      if (!validation.valid && validation.warning) {
        warnings.push(validation.warning);
      }
      
      text = extracted;
    }

    return {
      text: text || undefined,
      usage,
      finishReason,
      rawCall: {
        rawPrompt: messagesPrompt,
        rawSettings: queryOptions,
      },
      warnings: warnings.length > 0 ? warnings : undefined,
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
    options: Parameters<LanguageModelV1['doStream']>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV1['doStream']>>> {
    const { messagesPrompt } = convertToClaudeCodeMessages(options.prompt, options.mode);

    const abortController = new AbortController();
    if (options.abortSignal) {
      options.abortSignal.addEventListener('abort', () => abortController.abort());
    }

    const queryOptions = this.createQueryOptions(abortController);

    const warnings: LanguageModelV1CallWarning[] = this.generateUnsupportedWarnings(options);

    const stream = new ReadableStream<LanguageModelV1StreamPart>({
      start: async (controller) => {
        try {
          const response = query({
            prompt: messagesPrompt,
            options: queryOptions,
          });

          let usage = { promptTokens: 0, completionTokens: 0 };
          let accumulatedText = '';

          for await (const message of response) {
            if (message.type === 'assistant') {
              const text = message.message.content
                .map((c: { type: string; text?: string }) => (c.type === 'text' ? c.text : ''))
                .join('');
              
              if (text) {
                accumulatedText += text;
                
                // In object-json mode, we need to accumulate the full text
                // and extract JSON at the end, so don't stream individual deltas
                if (options.mode?.type !== 'object-json') {
                  controller.enqueue({
                    type: 'text-delta',
                    textDelta: text,
                  });
                }
              }
            } else if (message.type === 'result') {
              let rawUsage: unknown | undefined;
              if ('usage' in message) {
                rawUsage = message.usage;
                usage = {
                  promptTokens: (message.usage.cache_creation_input_tokens ?? 0) + 
                               (message.usage.cache_read_input_tokens ?? 0) +
                               (message.usage.input_tokens ?? 0),
                  completionTokens: message.usage.output_tokens ?? 0,
                };
              }

              let finishReason: LanguageModelV1FinishReason = 'stop';
              if (message.subtype === 'error_max_turns') {
                finishReason = 'length';
              } else if (message.subtype === 'error_during_execution') {
                finishReason = 'error';
              }

              // Store session ID in the model instance
              this.sessionId = message.session_id;
              
              // In object-json mode, extract JSON and send the full text at once
              if (options.mode?.type === 'object-json' && accumulatedText) {
                const extractedJson = extractJson(accumulatedText);
                this.validateJsonExtraction(accumulatedText, extractedJson);
                
                // If validation failed, we should add a warning but we can't modify warnings array in stream
                // So we'll just send the extracted JSON anyway
                // In the future, we could emit a warning stream part if the SDK supports it
                
                controller.enqueue({
                  type: 'text-delta',
                  textDelta: extractedJson,
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
              this.sessionId = message.session_id;
              
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
          let errorToEmit: unknown;
          
          // Special handling for AbortError to preserve abort signal reason
          if (error instanceof AbortError) {
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
        }
      },
    });

    return {
      stream,
      rawCall: {
        rawPrompt: messagesPrompt,
        rawSettings: queryOptions,
      },
      warnings: warnings.length > 0 ? warnings : undefined,
      request: {
        body: messagesPrompt,
      },
    };
  }
}