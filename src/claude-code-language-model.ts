import type {
  LanguageModelV2,
  LanguageModelV2CallWarning,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
  JSONValue,
} from '@ai-sdk/provider';
import { NoSuchModelError } from '@ai-sdk/provider';
import { generateId } from '@ai-sdk/provider-utils';
import type { ClaudeCodeSettings, Logger } from './types.js';
import { convertToClaudeCodeMessages } from './convert-to-claude-code-messages.js';
import { extractJson } from './extract-json.js';
import { mapClaudeCodeFinishReason } from './map-claude-code-finish-reason.js';
import { validateModelId, validateSessionId } from './validation.js';
import { getLogger, createVerboseLogger } from './logger.js';
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { ToolStreamManager } from './tool-stream-manager.js';
import { QueryOptionsBuilder } from './query-options-builder.js';
import { ErrorHandler } from './error-handler.js';
import { WarningGenerator } from './warning-generator.js';
import { StreamingUtils } from './streaming-utils.js';

const CLAUDE_CODE_TRUNCATION_WARNING =
  'Claude Code SDK output ended unexpectedly; returning truncated response from buffered text. Await upstream fix to avoid data loss.';

const STREAMING_FEATURE_WARNING =
  "Claude Agent SDK features (hooks/MCP/images) require streaming input. Set `streamingInput: 'always'` or provide `canUseTool` (auto streams only when canUseTool is set).";

export interface ClaudeCodeLanguageModelOptions {
  id: ClaudeCodeModelId;
  settings?: ClaudeCodeSettings;
  settingsValidationWarnings?: string[];
}

export type ClaudeCodeModelId = 'opus' | 'sonnet' | 'haiku' | (string & {});

const MODEL_MAP: Record<string, string> = {
  opus: 'opus',
  sonnet: 'sonnet',
  haiku: 'haiku',
};

type MessageFromSDK = {
  type: string;
  message?: {
    content?: unknown;
  };
  session_id?: string;
  subtype?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  usage?: {
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
};

export class ClaudeCodeLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = 'v2' as const;
  readonly defaultObjectGenerationMode = 'json' as const;
  readonly supportsImageUrls = false;
  readonly supportedUrls = {};
  readonly supportsStructuredOutputs = false;

  readonly modelId: ClaudeCodeModelId;
  readonly settings: ClaudeCodeSettings;

  private sessionId?: string;
  private readonly logger: Logger;
  private readonly warningGenerator: WarningGenerator;

  constructor(options: ClaudeCodeLanguageModelOptions) {
    this.modelId = options.id;
    this.settings = options.settings ?? {};

    const baseLogger = getLogger(this.settings.logger);
    this.logger = createVerboseLogger(baseLogger, this.settings.verbose ?? false);

    this.validateModelId();

    const modelValidationWarning = validateModelId(this.modelId);
    if (modelValidationWarning) {
      this.logger.warn(`Claude Code Model: ${modelValidationWarning}`);
    }

    this.warningGenerator = new WarningGenerator(
      modelValidationWarning,
      options.settingsValidationWarnings
    );
  }

  get provider(): string {
    return 'claude-code';
  }

  async doGenerate(
    options: Parameters<LanguageModelV2['doGenerate']>[0]
  ): Promise<Awaited<ReturnType<LanguageModelV2['doGenerate']>>> {
    this.logger.debug(`[claude-code] Starting doGenerate request with model: ${this.modelId}`);

    const executor = new GenerateExecutor(
      this.settings,
      this.modelId,
      this.logger,
      this.warningGenerator,
      this.sessionId,
      (id: string) => this.setSessionId(id)
    );

    return executor.execute(options);
  }

  async doStream(
    options: Parameters<LanguageModelV2['doStream']>[0]
  ): Promise<Awaited<ReturnType<LanguageModelV2['doStream']>>> {
    this.logger.debug(`[claude-code] Starting doStream request with model: ${this.modelId}`);

    const executor = new StreamExecutor(
      this.settings,
      this.modelId,
      this.logger,
      this.warningGenerator,
      this.sessionId,
      (id: string) => this.setSessionId(id)
    );

    return executor.execute(options);
  }

  private validateModelId(): void {
    if (!this.modelId || typeof this.modelId !== 'string' || this.modelId.trim() === '') {
      throw new NoSuchModelError({
        modelId: this.modelId,
        modelType: 'languageModel',
      });
    }
  }

  private setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
    const warning = validateSessionId(sessionId);
    if (warning) {
      this.logger.warn(`Claude Code Session: ${warning}`);
    }
  }
}

abstract class BaseExecutor {
  protected readonly settings: ClaudeCodeSettings;
  protected readonly modelId: ClaudeCodeModelId;
  protected readonly logger: Logger;
  protected readonly warningGenerator: WarningGenerator;
  protected readonly sessionId?: string;
  protected readonly setSessionIdCallback: (id: string) => void;

  constructor(
    settings: ClaudeCodeSettings,
    modelId: ClaudeCodeModelId,
    logger: Logger,
    warningGenerator: WarningGenerator,
    sessionId: string | undefined,
    setSessionIdCallback: (id: string) => void
  ) {
    this.settings = settings;
    this.modelId = modelId;
    this.logger = logger;
    this.warningGenerator = warningGenerator;
    this.sessionId = sessionId;
    this.setSessionIdCallback = setSessionIdCallback;
  }

  protected getModel(): string {
    const mapped = MODEL_MAP[this.modelId];
    return mapped ?? this.modelId;
  }

  protected determineMode(
    responseFormat?: { type: string }
  ): { type: 'object-json' } | { type: 'regular' } {
    return responseFormat?.type === 'json'
      ? { type: 'object-json' as const }
      : { type: 'regular' as const };
  }

  protected setupAbortController(
    abortSignal?: AbortSignal
  ): { abortController: AbortController; abortListener?: () => void } {
    const abortController = new AbortController();
    let abortListener: (() => void) | undefined;

    if (abortSignal?.aborted) {
      abortController.abort(abortSignal.reason);
    } else if (abortSignal) {
      abortListener = () => abortController.abort(abortSignal?.reason);
      abortSignal.addEventListener('abort', abortListener, { once: true });
    }

    return { abortController, abortListener };
  }

  protected cleanupAbortListener(abortSignal?: AbortSignal, abortListener?: () => void): void {
    if (abortSignal && abortListener) {
      abortSignal.removeEventListener('abort', abortListener);
    }
  }

  protected calculateUsage(message: MessageFromSDK): {
    usage: LanguageModelV2Usage;
    rawUsage: unknown | undefined;
  } {
    if (!('usage' in message)) {
      return {
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        rawUsage: undefined,
      };
    }

    const rawUsage = message.usage;
    const usage: LanguageModelV2Usage = {
      inputTokens:
        (rawUsage?.cache_creation_input_tokens ?? 0) +
        (rawUsage?.cache_read_input_tokens ?? 0) +
        (rawUsage?.input_tokens ?? 0),
      outputTokens: rawUsage?.output_tokens ?? 0,
      totalTokens:
        (rawUsage?.cache_creation_input_tokens ?? 0) +
        (rawUsage?.cache_read_input_tokens ?? 0) +
        (rawUsage?.input_tokens ?? 0) +
        (rawUsage?.output_tokens ?? 0),
    };

    this.logger.debug(
      `[claude-code] Token usage - Input: ${usage.inputTokens}, Output: ${usage.outputTokens}, Total: ${usage.totalTokens}`
    );

    return { usage, rawUsage };
  }

  protected handleJsonExtraction(
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

  protected validateJsonExtraction(
    originalText: string,
    extractedJson: string
  ): { valid: boolean; warning?: LanguageModelV2CallWarning } {
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

  protected createStreamingPromise(): {
    outputStreamEnded: Promise<unknown>;
    done: () => void;
  } {
    let done = () => {};
    const outputStreamEnded = new Promise((resolve) => {
      done = () => resolve(undefined);
    });
    return { outputStreamEnded, done };
  }
}

class GenerateExecutor extends BaseExecutor {
  async execute(
    options: Parameters<LanguageModelV2['doGenerate']>[0]
  ): Promise<Awaited<ReturnType<LanguageModelV2['doGenerate']>>> {
    const mode = this.determineMode(options.responseFormat);
    this.logger.debug(
      `[claude-code] Request mode: ${mode.type}, response format: ${options.responseFormat?.type ?? 'none'}`
    );

    const { messagesPrompt, warnings: messageWarnings, streamingContentParts, hasImageParts } =
      convertToClaudeCodeMessages(
        options.prompt,
        mode,
        options.responseFormat?.type === 'json' ? options.responseFormat.schema : undefined
      );

    this.logger.debug(
      `[claude-code] Converted ${options.prompt.length} messages, hasImageParts: ${hasImageParts}`
    );

    const { abortController, abortListener } = this.setupAbortController(options.abortSignal);

    const builder = new QueryOptionsBuilder(
      this.settings,
      this.getModel(),
      abortController,
      this.logger
    );
    const queryOptions = builder.build(this.sessionId);

    const warnings = this.warningGenerator.generateAllWarnings(options, messagesPrompt);
    messageWarnings?.forEach((warning) => {
      warnings.push({ type: 'other', message: warning });
    });

    const wantsStreamInput = StreamingUtils.shouldUseStreamingInput(
      this.settings.streamingInput,
      !!this.settings.canUseTool
    );

    if (!wantsStreamInput && hasImageParts) {
      warnings.push({ type: 'other', message: STREAMING_FEATURE_WARNING });
    }

    const { outputStreamEnded, done } = this.createStreamingPromise();

    let text = '';
    let usage: LanguageModelV2Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let finishReason: LanguageModelV2FinishReason = 'stop';
    let wasTruncated = false;
    let costUsd: number | undefined;
    let durationMs: number | undefined;
    let rawUsage: unknown | undefined;

    try {
      StreamingUtils.validateStreamingRequirements(
        this.settings.canUseTool,
        this.settings.permissionPromptToolName
      );

      const sdkPrompt = wantsStreamInput
        ? StreamingUtils.toAsyncIterablePrompt(
            messagesPrompt,
            outputStreamEnded,
            this.settings.resume ?? this.sessionId,
            streamingContentParts
          )
        : messagesPrompt;

      this.logger.debug(
        `[claude-code] Executing query with streamingInput: ${wantsStreamInput}, session: ${this.settings.resume ?? this.sessionId ?? 'new'}`
      );

      const response = query({ prompt: sdkPrompt, options: queryOptions });

      for await (const message of response) {
        this.logger.debug(`[claude-code] Received message type: ${message.type}`);

        if (message.type === 'assistant') {
          text += this.extractTextFromContent(message.message?.content);
        } else if (message.type === 'result') {
          done();
          this.setSessionIdCallback(message.session_id ?? '');
          costUsd = message.total_cost_usd;
          durationMs = message.duration_ms;

          this.logger.info(
            `[claude-code] Request completed - Session: ${message.session_id}, Cost: $${costUsd?.toFixed(4) ?? 'N/A'}, Duration: ${durationMs ?? 'N/A'}ms`
          );

          const usageResult = this.calculateUsage(message);
          usage = usageResult.usage;
          rawUsage = usageResult.rawUsage;

          finishReason = mapClaudeCodeFinishReason(message.subtype);
          this.logger.debug(`[claude-code] Finish reason: ${finishReason}`);
        } else if (message.type === 'system' && message.subtype === 'init') {
          this.setSessionIdCallback(message.session_id ?? '');
          this.logger.info(`[claude-code] Session initialized: ${message.session_id}`);
        }
      }
    } catch (error: unknown) {
      done();
      this.logger.debug(
        `[claude-code] Error during doGenerate: ${error instanceof Error ? error.message : String(error)}`
      );

      if (ErrorHandler.isAbortError(error)) {
        this.logger.debug('[claude-code] Request aborted by user');
        throw options.abortSignal?.aborted ? options.abortSignal.reason : error;
      }

      if (ErrorHandler.isClaudeCodeTruncationError(error, text)) {
        this.logger.warn(
          `[claude-code] Detected truncated response, returning ${text.length} characters of buffered text`
        );
        wasTruncated = true;
        finishReason = 'length';
        warnings.push({ type: 'other', message: CLAUDE_CODE_TRUNCATION_WARNING });
      } else {
        throw ErrorHandler.handleClaudeCodeError(error, messagesPrompt);
      }
    } finally {
      this.cleanupAbortListener(options.abortSignal, abortListener);
    }

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
      request: { body: messagesPrompt },
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

  private extractTextFromContent(content: unknown): string {
    if (!Array.isArray(content)) {
      return '';
    }
    return content
      .map((c: { type: string; text?: string }) => (c.type === 'text' ? c.text : ''))
      .join('');
  }
}

class StreamExecutor extends BaseExecutor {
  async execute(
    options: Parameters<LanguageModelV2['doStream']>[0]
  ): Promise<Awaited<ReturnType<LanguageModelV2['doStream']>>> {
    const mode = this.determineMode(options.responseFormat);
    this.logger.debug(
      `[claude-code] Stream mode: ${mode.type}, response format: ${options.responseFormat?.type ?? 'none'}`
    );

    const { messagesPrompt, warnings: messageWarnings, streamingContentParts, hasImageParts } =
      convertToClaudeCodeMessages(
        options.prompt,
        mode,
        options.responseFormat?.type === 'json' ? options.responseFormat.schema : undefined
      );

    this.logger.debug(
      `[claude-code] Converted ${options.prompt.length} messages for streaming, hasImageParts: ${hasImageParts}`
    );

    const { abortController, abortListener } = this.setupAbortController(options.abortSignal);

    const builder = new QueryOptionsBuilder(
      this.settings,
      this.getModel(),
      abortController,
      this.logger
    );
    const queryOptions = builder.build(this.sessionId);

    const warnings = this.warningGenerator.generateAllWarnings(options, messagesPrompt);
    messageWarnings?.forEach((warning) => {
      warnings.push({ type: 'other', message: warning });
    });

    const wantsStreamInput = StreamingUtils.shouldUseStreamingInput(
      this.settings.streamingInput,
      !!this.settings.canUseTool
    );

    if (!wantsStreamInput && hasImageParts) {
      warnings.push({ type: 'other', message: STREAMING_FEATURE_WARNING });
    }

    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      start: async (controller) => {
        const processor = new StreamProcessor(
          options,
          messagesPrompt,
          queryOptions,
          wantsStreamInput,
          streamingContentParts,
          this.settings,
          this.sessionId,
          this.modelId,
          this.logger,
          warnings,
          this.setSessionIdCallback.bind(this),
          this.warningGenerator,
          this.handleJsonExtraction.bind(this)
        );

        await processor.process(controller);
      },
      cancel: () => {
        this.cleanupAbortListener(options.abortSignal, abortListener);
      },
    });

    return {
      stream,
      request: { body: messagesPrompt },
    };
  }
}

class StreamProcessor {
  private readonly options: Parameters<LanguageModelV2['doStream']>[0];
  private readonly messagesPrompt: string;
  private readonly queryOptions: Options;
  private readonly wantsStreamInput: boolean;
  private readonly streamingContentParts: SDKUserMessage['message']['content'] | undefined;
  private readonly settings: ClaudeCodeSettings;
  private readonly sessionId?: string;
  private readonly modelId: ClaudeCodeModelId;
  private readonly logger: Logger;
  private readonly initialWarnings: LanguageModelV2CallWarning[];
  private readonly setSessionIdCallback: (id: string) => void;
  private readonly warningGenerator: WarningGenerator;
  private readonly handleJsonExtraction: (
    text: string,
    warnings: LanguageModelV2CallWarning[]
  ) => string;

  private toolManager!: ToolStreamManager;
  private accumulatedText = '';
  private textPartId?: string;
  private usage: LanguageModelV2Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  private streamWarnings: LanguageModelV2CallWarning[] = [];

  constructor(
    options: Parameters<LanguageModelV2['doStream']>[0],
    messagesPrompt: string,
    queryOptions: Options,
    wantsStreamInput: boolean,
    streamingContentParts: SDKUserMessage['message']['content'] | undefined,
    settings: ClaudeCodeSettings,
    sessionId: string | undefined,
    modelId: ClaudeCodeModelId,
    logger: Logger,
    initialWarnings: LanguageModelV2CallWarning[],
    setSessionIdCallback: (id: string) => void,
    warningGenerator: WarningGenerator,
    handleJsonExtraction: (text: string, warnings: LanguageModelV2CallWarning[]) => string
  ) {
    this.options = options;
    this.messagesPrompt = messagesPrompt;
    this.queryOptions = queryOptions;
    this.wantsStreamInput = wantsStreamInput;
    this.streamingContentParts = streamingContentParts;
    this.settings = settings;
    this.sessionId = sessionId;
    this.modelId = modelId;
    this.logger = logger;
    this.initialWarnings = initialWarnings;
    this.setSessionIdCallback = setSessionIdCallback;
    this.warningGenerator = warningGenerator;
    this.handleJsonExtraction = handleJsonExtraction;
  }

  async process(controller: ReadableStreamDefaultController<LanguageModelV2StreamPart>): Promise<void> {
    const { outputStreamEnded, done } = this.createStreamingPromise();
    this.toolManager = new ToolStreamManager((msg: string) => {
      if (msg.includes('Large tool input detected')) {
        this.logger.warn(`[claude-code] ${msg}`);
      } else {
        this.logger.debug(`[claude-code] ${msg}`);
      }
    });

    try {
      controller.enqueue({ type: 'stream-start', warnings: this.initialWarnings });

      StreamingUtils.validateStreamingRequirements(
        this.settings.canUseTool,
        this.settings.permissionPromptToolName
      );

      const sdkPrompt = this.wantsStreamInput
        ? StreamingUtils.toAsyncIterablePrompt(
            this.messagesPrompt,
            outputStreamEnded,
            this.settings.resume ?? this.sessionId,
            this.streamingContentParts
          )
        : this.messagesPrompt;

      this.logger.debug(
        `[claude-code] Starting stream query with streamingInput: ${this.wantsStreamInput}, session: ${this.settings.resume ?? this.sessionId ?? 'new'}`
      );

      const response = query({ prompt: sdkPrompt, options: this.queryOptions });

      for await (const message of response) {
        await this.processMessage(message, controller);
      }

      this.toolManager.finalizeAllToolCalls(controller);
      this.logger.debug('[claude-code] Stream finalized, closing stream');
      controller.close();
    } catch (error: unknown) {
      done();
      await this.handleStreamError(error, controller, done);
    }
  }

  private async processMessage(
    message: MessageFromSDK,
    controller: ReadableStreamDefaultController<LanguageModelV2StreamPart>
  ): Promise<void> {
    this.logger.debug(`[claude-code] Stream received message type: ${message.type}`);

    if (message.type === 'assistant') {
      this.processAssistantMessage(message, controller);
    } else if (message.type === 'user') {
      this.processUserMessage(message, controller);
    } else if (message.type === 'result') {
      await this.processResultMessage(message, controller);
    } else if (message.type === 'system' && message.subtype === 'init') {
      this.processInitMessage(message, controller);
    }
  }

  private processAssistantMessage(
    message: MessageFromSDK,
    controller: ReadableStreamDefaultController<LanguageModelV2StreamPart>
  ): void {
    if (!message.message?.content) {
      this.logger.warn(
        `[claude-code] Unexpected assistant message structure: missing content field. Message type: ${message.type}.`
      );
      return;
    }

    const content = message.message.content;

    for (const tool of this.toolManager.extractToolUses(content)) {
      this.toolManager.processToolUse(tool, controller);
    }

    const text = this.extractTextFromContent(content);
    if (text) {
      this.accumulatedText += text;

      if (this.options.responseFormat?.type !== 'json') {
        if (!this.textPartId) {
          this.textPartId = generateId();
          controller.enqueue({ type: 'text-start', id: this.textPartId });
        }
        controller.enqueue({ type: 'text-delta', id: this.textPartId, delta: text });
      }
    }
  }

  private processUserMessage(
    message: MessageFromSDK,
    controller: ReadableStreamDefaultController<LanguageModelV2StreamPart>
  ): void {
    if (!message.message?.content) {
      this.logger.warn(
        `[claude-code] Unexpected user message structure: missing content field. Message type: ${message.type}.`
      );
      return;
    }

    const content = message.message.content;

    for (const result of this.toolManager.extractToolResults(content)) {
      this.toolManager.processToolResult(result, controller);
    }

    for (const error of this.toolManager.extractToolErrors(content)) {
      this.toolManager.processToolError(error, controller);
    }
  }

  private async processResultMessage(
    message: MessageFromSDK,
    controller: ReadableStreamDefaultController<LanguageModelV2StreamPart>
  ): Promise<void> {
    this.logger.info(
      `[claude-code] Stream completed - Session: ${message.session_id}, Cost: $${message.total_cost_usd?.toFixed(4) ?? 'N/A'}, Duration: ${message.duration_ms ?? 'N/A'}ms`
    );

    const { usage, rawUsage } = this.calculateUsageFromMessage(message);
    this.usage = usage;

    const finishReason: LanguageModelV2FinishReason = mapClaudeCodeFinishReason(message.subtype);
    this.logger.debug(`[claude-code] Stream finish reason: ${finishReason}`);

    this.setSessionIdCallback(message.session_id ?? '');

    if (this.options.responseFormat?.type === 'json' && this.accumulatedText) {
      this.emitJsonText(controller);
    } else if (this.textPartId) {
      controller.enqueue({ type: 'text-end', id: this.textPartId });
    }

    this.toolManager.finalizeAllToolCalls(controller);

    const warningsJson = this.warningGenerator.serializeWarningsForMetadata(this.streamWarnings);

    controller.enqueue({
      type: 'finish',
      finishReason,
      usage: this.usage,
      providerMetadata: {
        'claude-code': {
          sessionId: message.session_id ?? '',
          ...(message.total_cost_usd !== undefined && { costUsd: message.total_cost_usd }),
          ...(message.duration_ms !== undefined && { durationMs: message.duration_ms }),
          ...(rawUsage !== undefined && { rawUsage: rawUsage as JSONValue }),
          ...(this.streamWarnings.length > 0 && {
            warnings: warningsJson as unknown as JSONValue,
          }),
        },
      },
    });
  }

  private processInitMessage(
    message: MessageFromSDK,
    controller: ReadableStreamDefaultController<LanguageModelV2StreamPart>
  ): void {
    this.setSessionIdCallback(message.session_id ?? '');
    this.logger.info(`[claude-code] Stream session initialized: ${message.session_id}`);

    controller.enqueue({
      type: 'response-metadata',
      id: message.session_id ?? '',
      timestamp: new Date(),
      modelId: this.modelId,
    });
  }

  private async handleStreamError(
    error: unknown,
    controller: ReadableStreamDefaultController<LanguageModelV2StreamPart>,
    _done: () => void
  ): Promise<void> {
    this.logger.debug(
      `[claude-code] Error during doStream: ${error instanceof Error ? error.message : String(error)}`
    );

    if (ErrorHandler.isClaudeCodeTruncationError(error, this.accumulatedText)) {
      this.handleTruncatedStream(controller);
      return;
    }

    this.toolManager.finalizeAllToolCalls(controller);
    let errorToEmit: unknown;

    if (ErrorHandler.isAbortError(error)) {
      errorToEmit = this.options.abortSignal?.aborted ? this.options.abortSignal.reason : error;
    } else {
      errorToEmit = ErrorHandler.handleClaudeCodeError(error, this.messagesPrompt);
    }

    controller.enqueue({ type: 'error', error: errorToEmit });
    controller.close();
  }

  private handleTruncatedStream(
    controller: ReadableStreamDefaultController<LanguageModelV2StreamPart>
  ): void {
    this.logger.warn(
      `[claude-code] Detected truncated stream response, returning ${this.accumulatedText.length} characters of buffered text`
    );

    const truncationWarning: LanguageModelV2CallWarning = {
      type: 'other',
      message: CLAUDE_CODE_TRUNCATION_WARNING,
    };
    this.streamWarnings.push(truncationWarning);

    if (this.options.responseFormat?.type === 'json') {
      this.emitJsonText(controller);
    } else if (this.textPartId) {
      controller.enqueue({ type: 'text-end', id: this.textPartId });
    } else if (this.accumulatedText) {
      const fallbackTextId = generateId();
      controller.enqueue({ type: 'text-start', id: fallbackTextId });
      controller.enqueue({ type: 'text-delta', id: fallbackTextId, delta: this.accumulatedText });
      controller.enqueue({ type: 'text-end', id: fallbackTextId });
    }

    this.toolManager.finalizeAllToolCalls(controller);

    const warningsJson = this.warningGenerator.serializeWarningsForMetadata(this.streamWarnings);

    controller.enqueue({
      type: 'finish',
      finishReason: 'length',
      usage: this.usage,
      providerMetadata: {
        'claude-code': {
          ...(this.sessionId !== undefined && { sessionId: this.sessionId }),
          truncated: true,
          ...(this.streamWarnings.length > 0 && {
            warnings: warningsJson as unknown as JSONValue,
          }),
        },
      },
    });

    controller.close();
  }

  private emitJsonText(controller: ReadableStreamDefaultController<LanguageModelV2StreamPart>): void {
    const extractedJson = this.handleJsonExtraction(this.accumulatedText, this.streamWarnings);
    const jsonTextId = generateId();
    controller.enqueue({ type: 'text-start', id: jsonTextId });
    controller.enqueue({ type: 'text-delta', id: jsonTextId, delta: extractedJson });
    controller.enqueue({ type: 'text-end', id: jsonTextId });
  }

  private extractTextFromContent(content: unknown): string {
    if (!Array.isArray(content)) {
      return '';
    }
    return content
      .map((c: { type: string; text?: string }) => (c.type === 'text' ? c.text : ''))
      .join('');
  }

  private calculateUsageFromMessage(message: MessageFromSDK): {
    usage: LanguageModelV2Usage;
    rawUsage: unknown | undefined;
  } {
    if (!('usage' in message)) {
      return {
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        rawUsage: undefined,
      };
    }

    const rawUsage = message.usage;
    const usage: LanguageModelV2Usage = {
      inputTokens:
        (rawUsage?.cache_creation_input_tokens ?? 0) +
        (rawUsage?.cache_read_input_tokens ?? 0) +
        (rawUsage?.input_tokens ?? 0),
      outputTokens: rawUsage?.output_tokens ?? 0,
      totalTokens:
        (rawUsage?.cache_creation_input_tokens ?? 0) +
        (rawUsage?.cache_read_input_tokens ?? 0) +
        (rawUsage?.input_tokens ?? 0) +
        (rawUsage?.output_tokens ?? 0),
    };

    this.logger.debug(
      `[claude-code] Stream token usage - Input: ${usage.inputTokens}, Output: ${usage.outputTokens}, Total: ${usage.totalTokens}`
    );

    return { usage, rawUsage };
  }

  private createStreamingPromise(): {
    outputStreamEnded: Promise<unknown>;
    done: () => void;
  } {
    let done = () => {};
    const outputStreamEnded = new Promise((resolve) => {
      done = () => resolve(undefined);
    });
    return { outputStreamEnded, done };
  }
}
