// src/claude-code-provider.ts
import { NoSuchModelError as NoSuchModelError2 } from "@ai-sdk/provider";

// src/claude-code-language-model.ts
import { NoSuchModelError } from "@ai-sdk/provider";
import { generateId } from "@ai-sdk/provider-utils";

// src/convert-to-claude-code-messages.ts
var IMAGE_URL_WARNING = "Image URLs are not supported by this provider; supply base64/data URLs.";
var IMAGE_CONVERSION_WARNING = "Unable to convert image content; supply base64/data URLs.";
function normalizeBase64(base64) {
  return base64.replace(/\s+/g, "");
}
function isImageMimeType(mimeType) {
  return typeof mimeType === "string" && mimeType.trim().toLowerCase().startsWith("image/");
}
function createImageContent(mediaType, data) {
  const trimmedType = mediaType.trim();
  const trimmedData = normalizeBase64(data.trim());
  if (!trimmedType || !trimmedData) {
    return void 0;
  }
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: trimmedType,
      data: trimmedData
    }
  };
}
function extractMimeType(candidate) {
  if (typeof candidate === "string" && candidate.trim()) {
    return candidate.trim();
  }
  return void 0;
}
function parseObjectImage(imageObj, fallbackMimeType) {
  const data = typeof imageObj.data === "string" ? imageObj.data : void 0;
  const mimeType = extractMimeType(
    imageObj.mimeType ?? imageObj.mediaType ?? imageObj.media_type ?? fallbackMimeType
  );
  if (!data || !mimeType) {
    return void 0;
  }
  return createImageContent(mimeType, data);
}
function parseStringImage(value, fallbackMimeType) {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return { warning: IMAGE_URL_WARNING };
  }
  const dataUrlMatch = trimmed.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    const [, mediaType, data] = dataUrlMatch;
    const content = createImageContent(mediaType, data);
    return content ? { content } : { warning: IMAGE_CONVERSION_WARNING };
  }
  const base64Match = trimmed.match(/^base64:([^,]+),(.+)$/i);
  if (base64Match) {
    const [, explicitMimeType, data] = base64Match;
    const content = createImageContent(explicitMimeType, data);
    return content ? { content } : { warning: IMAGE_CONVERSION_WARNING };
  }
  if (fallbackMimeType) {
    const content = createImageContent(fallbackMimeType, trimmed);
    if (content) {
      return { content };
    }
  }
  return { warning: IMAGE_CONVERSION_WARNING };
}
function parseImagePart(part) {
  if (!part || typeof part !== "object") {
    return { warning: IMAGE_CONVERSION_WARNING };
  }
  const imageValue = part.image;
  const mimeType = extractMimeType(part.mimeType);
  if (typeof imageValue === "string") {
    return parseStringImage(imageValue, mimeType);
  }
  if (imageValue && typeof imageValue === "object") {
    const content = parseObjectImage(imageValue, mimeType);
    return content ? { content } : { warning: IMAGE_CONVERSION_WARNING };
  }
  return { warning: IMAGE_CONVERSION_WARNING };
}
function convertBinaryToBase64(data) {
  if (typeof Buffer !== "undefined") {
    const buffer = data instanceof Uint8Array ? Buffer.from(data) : Buffer.from(new Uint8Array(data));
    return buffer.toString("base64");
  }
  if (typeof btoa === "function") {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    let binary = "";
    const chunkSize = 32768;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }
  return void 0;
}
function parseFilePart(part) {
  const mimeType = extractMimeType(part.mediaType ?? part.mimeType);
  if (!mimeType || !isImageMimeType(mimeType)) {
    return {};
  }
  const data = part.data;
  if (typeof data === "string") {
    const content = createImageContent(mimeType, data);
    return content ? { content } : { warning: IMAGE_CONVERSION_WARNING };
  }
  if (data instanceof Uint8Array || typeof ArrayBuffer !== "undefined" && data instanceof ArrayBuffer) {
    const base64 = convertBinaryToBase64(data);
    if (!base64) {
      return { warning: IMAGE_CONVERSION_WARNING };
    }
    const content = createImageContent(mimeType, base64);
    return content ? { content } : { warning: IMAGE_CONVERSION_WARNING };
  }
  return { warning: IMAGE_CONVERSION_WARNING };
}
function convertToClaudeCodeMessages(prompt) {
  const messages = [];
  const warnings = [];
  let systemPrompt;
  const streamingSegments = [];
  const imageMap = /* @__PURE__ */ new Map();
  let hasImageParts = false;
  const addSegment = (formatted) => {
    streamingSegments.push({ formatted });
    return streamingSegments.length - 1;
  };
  const addImageForSegment = (segmentIndex, content) => {
    hasImageParts = true;
    if (!imageMap.has(segmentIndex)) {
      imageMap.set(segmentIndex, []);
    }
    imageMap.get(segmentIndex)?.push(content);
  };
  for (const message of prompt) {
    switch (message.role) {
      case "system":
        systemPrompt = message.content;
        if (typeof message.content === "string" && message.content.trim().length > 0) {
          addSegment(message.content);
        } else {
          addSegment("");
        }
        break;
      case "user":
        if (typeof message.content === "string") {
          messages.push(message.content);
          addSegment(`Human: ${message.content}`);
        } else {
          const textParts = message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
          const segmentIndex = addSegment(textParts ? `Human: ${textParts}` : "");
          if (textParts) {
            messages.push(textParts);
          }
          for (const part of message.content) {
            if (part.type === "image") {
              const { content, warning } = parseImagePart(part);
              if (content) {
                addImageForSegment(segmentIndex, content);
              } else if (warning) {
                warnings.push(warning);
              }
            } else if (part.type === "file") {
              const { content, warning } = parseFilePart(part);
              if (content) {
                addImageForSegment(segmentIndex, content);
              } else if (warning) {
                warnings.push(warning);
              }
            }
          }
        }
        break;
      case "assistant": {
        let assistantContent = "";
        if (typeof message.content === "string") {
          assistantContent = message.content;
        } else {
          const textParts = message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
          if (textParts) {
            assistantContent = textParts;
          }
          const toolCalls = message.content.filter((part) => part.type === "tool-call");
          if (toolCalls.length > 0) {
            assistantContent += `
[Tool calls made]`;
          }
        }
        const formattedAssistant = `Assistant: ${assistantContent}`;
        messages.push(formattedAssistant);
        addSegment(formattedAssistant);
        break;
      }
      case "tool":
        for (const tool3 of message.content) {
          if (tool3.type === "tool-approval-response") {
            continue;
          }
          let resultText;
          const output = tool3.output;
          if (output.type === "text" || output.type === "error-text") {
            resultText = output.value;
          } else if (output.type === "json" || output.type === "error-json") {
            resultText = JSON.stringify(output.value);
          } else if (output.type === "execution-denied") {
            resultText = `[Execution denied${output.reason ? `: ${output.reason}` : ""}]`;
          } else if (output.type === "content") {
            resultText = output.value.filter((part) => part.type === "text").map((part) => part.text).join("\n");
          } else {
            resultText = "[Unknown output type]";
          }
          const formattedToolResult = `Tool Result (${tool3.toolName}): ${resultText}`;
          messages.push(formattedToolResult);
          addSegment(formattedToolResult);
        }
        break;
    }
  }
  let finalPrompt = "";
  if (systemPrompt) {
    finalPrompt = systemPrompt;
  }
  if (messages.length > 0) {
    const formattedMessages = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.startsWith("Assistant:") || msg.startsWith("Tool Result")) {
        formattedMessages.push(msg);
      } else {
        formattedMessages.push(`Human: ${msg}`);
      }
    }
    if (finalPrompt) {
      const joinedMessages = formattedMessages.join("\n\n");
      finalPrompt = joinedMessages ? `${finalPrompt}

${joinedMessages}` : finalPrompt;
    } else {
      finalPrompt = formattedMessages.join("\n\n");
    }
  }
  const streamingParts = [];
  const imagePartsInOrder = [];
  const appendImagesForIndex = (index) => {
    const images = imageMap.get(index);
    if (!images) {
      return;
    }
    images.forEach((image) => {
      streamingParts.push(image);
      imagePartsInOrder.push(image);
    });
  };
  if (streamingSegments.length > 0) {
    let accumulatedText = "";
    let emittedText = false;
    const flushText = () => {
      if (!accumulatedText) {
        return;
      }
      streamingParts.push({ type: "text", text: accumulatedText });
      accumulatedText = "";
      emittedText = true;
    };
    streamingSegments.forEach((segment, index) => {
      const segmentText = segment.formatted;
      if (segmentText) {
        if (!accumulatedText) {
          accumulatedText = emittedText ? `

${segmentText}` : segmentText;
        } else {
          accumulatedText += `

${segmentText}`;
        }
      }
      if (imageMap.has(index)) {
        flushText();
        appendImagesForIndex(index);
      }
    });
    flushText();
  }
  return {
    messagesPrompt: finalPrompt,
    systemPrompt,
    ...warnings.length > 0 && { warnings },
    streamingContentParts: streamingParts.length > 0 ? streamingParts : [
      { type: "text", text: finalPrompt },
      ...imagePartsInOrder
    ],
    hasImageParts
  };
}

// src/errors.ts
import { APICallError, LoadAPIKeyError } from "@ai-sdk/provider";
function createAPICallError({
  message,
  code,
  exitCode,
  stderr,
  promptExcerpt,
  isRetryable = false
}) {
  const metadata = {
    code,
    exitCode,
    stderr,
    promptExcerpt
  };
  return new APICallError({
    message,
    isRetryable,
    url: "claude-code-cli://command",
    requestBodyValues: promptExcerpt ? { prompt: promptExcerpt } : void 0,
    data: metadata
  });
}
function createAuthenticationError({ message }) {
  return new LoadAPIKeyError({
    message: message || "Authentication failed. Please ensure Claude Code SDK is properly authenticated."
  });
}
function createTimeoutError({
  message,
  promptExcerpt,
  timeoutMs
}) {
  const metadata = {
    code: "TIMEOUT",
    promptExcerpt
  };
  return new APICallError({
    message,
    isRetryable: true,
    url: "claude-code-cli://command",
    requestBodyValues: promptExcerpt ? { prompt: promptExcerpt } : void 0,
    data: timeoutMs !== void 0 ? { ...metadata, timeoutMs } : metadata
  });
}
function isAuthenticationError(error) {
  if (error instanceof LoadAPIKeyError) return true;
  if (error instanceof APICallError && error.data?.exitCode === 401)
    return true;
  return false;
}
function isTimeoutError(error) {
  if (error instanceof APICallError && error.data?.code === "TIMEOUT")
    return true;
  return false;
}
function getErrorMetadata(error) {
  if (error instanceof APICallError && error.data) {
    return error.data;
  }
  return void 0;
}

// src/map-claude-code-finish-reason.ts
function mapClaudeCodeFinishReason(subtype) {
  switch (subtype) {
    case "success":
      return { unified: "stop", raw: subtype };
    case "error_max_turns":
      return { unified: "length", raw: subtype };
    case "error_during_execution":
      return { unified: "error", raw: subtype };
    case void 0:
      return { unified: "stop", raw: void 0 };
    default:
      return { unified: "other", raw: subtype };
  }
}

// src/validation.ts
import { z } from "zod";
import { existsSync } from "fs";
var loggerFunctionSchema = z.object({
  debug: z.any().refine((val) => typeof val === "function", {
    message: "debug must be a function"
  }),
  info: z.any().refine((val) => typeof val === "function", {
    message: "info must be a function"
  }),
  warn: z.any().refine((val) => typeof val === "function", {
    message: "warn must be a function"
  }),
  error: z.any().refine((val) => typeof val === "function", {
    message: "error must be a function"
  })
});
var claudeCodeSettingsSchema = z.object({
  pathToClaudeCodeExecutable: z.string().optional(),
  customSystemPrompt: z.string().optional(),
  appendSystemPrompt: z.string().optional(),
  systemPrompt: z.union([
    z.string(),
    z.object({
      type: z.literal("preset"),
      preset: z.literal("claude_code"),
      append: z.string().optional()
    })
  ]).optional(),
  maxTurns: z.number().int().min(1).max(100).optional(),
  maxThinkingTokens: z.number().int().positive().max(1e5).optional(),
  cwd: z.string().refine(
    (val) => {
      if (typeof process === "undefined" || !process.versions?.node) {
        return true;
      }
      return !val || existsSync(val);
    },
    { message: "Working directory must exist" }
  ).optional(),
  executable: z.enum(["bun", "deno", "node"]).optional(),
  executableArgs: z.array(z.string()).optional(),
  permissionMode: z.enum(["default", "acceptEdits", "bypassPermissions", "plan", "delegate", "dontAsk"]).optional(),
  permissionPromptToolName: z.string().optional(),
  continue: z.boolean().optional(),
  resume: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  betas: z.array(z.string()).optional(),
  allowDangerouslySkipPermissions: z.boolean().optional(),
  enableFileCheckpointing: z.boolean().optional(),
  maxBudgetUsd: z.number().min(0).optional(),
  plugins: z.array(
    z.object({
      type: z.string(),
      path: z.string()
    }).passthrough()
  ).optional(),
  resumeSessionAt: z.string().optional(),
  sandbox: z.any().refine((val) => val === void 0 || typeof val === "object", {
    message: "sandbox must be an object"
  }).optional(),
  tools: z.union([
    z.array(z.string()),
    z.object({
      type: z.literal("preset"),
      preset: z.literal("claude_code")
    })
  ]).optional(),
  settingSources: z.array(z.enum(["user", "project", "local"])).optional(),
  streamingInput: z.enum(["auto", "always", "off"]).optional(),
  // Hooks and tool-permission callback (permissive validation of shapes)
  canUseTool: z.any().refine((v) => v === void 0 || typeof v === "function", {
    message: "canUseTool must be a function"
  }).optional(),
  hooks: z.record(
    z.string(),
    z.array(
      z.object({
        matcher: z.string().optional(),
        hooks: z.array(z.any()).nonempty()
      })
    )
  ).optional(),
  mcpServers: z.record(
    z.string(),
    z.union([
      // McpStdioServerConfig
      z.object({
        type: z.literal("stdio").optional(),
        command: z.string(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional()
      }),
      // McpSSEServerConfig
      z.object({
        type: z.literal("sse"),
        url: z.string(),
        headers: z.record(z.string(), z.string()).optional()
      }),
      // McpHttpServerConfig
      z.object({
        type: z.literal("http"),
        url: z.string(),
        headers: z.record(z.string(), z.string()).optional()
      }),
      // McpSdkServerConfig (in-process custom tools)
      z.object({
        type: z.literal("sdk"),
        name: z.string(),
        instance: z.any()
      })
    ])
  ).optional(),
  verbose: z.boolean().optional(),
  logger: z.union([z.literal(false), loggerFunctionSchema]).optional(),
  env: z.record(z.string(), z.string().optional()).optional(),
  additionalDirectories: z.array(z.string()).optional(),
  agents: z.record(
    z.string(),
    z.object({
      description: z.string(),
      tools: z.array(z.string()).optional(),
      disallowedTools: z.array(z.string()).optional(),
      prompt: z.string(),
      model: z.enum(["sonnet", "opus", "haiku", "inherit"]).optional(),
      mcpServers: z.array(
        z.union([
          z.string(),
          z.record(z.string(), z.any())
          // McpServerConfigForProcessTransport
        ])
      ).optional(),
      criticalSystemReminder_EXPERIMENTAL: z.string().optional()
    }).passthrough()
  ).optional(),
  includePartialMessages: z.boolean().optional(),
  fallbackModel: z.string().optional(),
  forkSession: z.boolean().optional(),
  stderr: z.any().refine((val) => val === void 0 || typeof val === "function", {
    message: "stderr must be a function"
  }).optional(),
  strictMcpConfig: z.boolean().optional(),
  extraArgs: z.record(z.string(), z.union([z.string(), z.null()])).optional(),
  persistSession: z.boolean().optional(),
  spawnClaudeCodeProcess: z.any().refine((val) => val === void 0 || typeof val === "function", {
    message: "spawnClaudeCodeProcess must be a function"
  }).optional(),
  sdkOptions: z.record(z.string(), z.any()).optional(),
  // Callback invoked when Query object is created - for mid-stream injection via streamInput()
  onQueryCreated: z.any().refine((val) => val === void 0 || typeof val === "function", {
    message: "onQueryCreated must be a function"
  }).optional()
}).strict();
function validateModelId(modelId) {
  const knownModels = ["opus", "sonnet", "haiku"];
  if (!modelId || modelId.trim() === "") {
    throw new Error("Model ID cannot be empty");
  }
  if (!knownModels.includes(modelId)) {
    return `Unknown model ID: '${modelId}'. Proceeding with custom model. Known models are: ${knownModels.join(", ")}`;
  }
  return void 0;
}
function validateSettings(settings) {
  const warnings = [];
  const errors = [];
  try {
    const result = claudeCodeSettingsSchema.safeParse(settings);
    if (!result.success) {
      const errorObject = result.error;
      const issues = errorObject.errors || errorObject.issues || [];
      issues.forEach((err) => {
        const path = err.path.join(".");
        errors.push(`${path ? `${path}: ` : ""}${err.message}`);
      });
      return { valid: false, warnings, errors };
    }
    const validSettings = result.data;
    if (validSettings.maxTurns && validSettings.maxTurns > 20) {
      warnings.push(
        `High maxTurns value (${validSettings.maxTurns}) may lead to long-running conversations`
      );
    }
    if (validSettings.maxThinkingTokens && validSettings.maxThinkingTokens > 5e4) {
      warnings.push(
        `Very high maxThinkingTokens (${validSettings.maxThinkingTokens}) may increase response time`
      );
    }
    if (validSettings.allowedTools && validSettings.disallowedTools) {
      warnings.push(
        "Both allowedTools and disallowedTools are specified. Only allowedTools will be used."
      );
    }
    const validateToolNames = (tools, type) => {
      tools.forEach((tool3) => {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\([^)]*\))?$/.test(tool3) && !tool3.startsWith("mcp__")) {
          warnings.push(`Unusual ${type} tool name format: '${tool3}'`);
        }
      });
    };
    if (validSettings.allowedTools) {
      validateToolNames(validSettings.allowedTools, "allowed");
    }
    if (validSettings.disallowedTools) {
      validateToolNames(validSettings.disallowedTools, "disallowed");
    }
    if (validSettings.allowedTools?.includes("Skill") && !validSettings.settingSources) {
      warnings.push(
        "allowedTools includes 'Skill' but settingSources is not set. Skills require settingSources (e.g., ['user', 'project']) to load skill definitions."
      );
    }
    return { valid: true, warnings, errors };
  } catch (error) {
    errors.push(`Validation error: ${error instanceof Error ? error.message : String(error)}`);
    return { valid: false, warnings, errors };
  }
}
function validatePrompt(prompt) {
  const MAX_PROMPT_LENGTH = 1e5;
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return `Very long prompt (${prompt.length} characters) may cause performance issues or timeouts`;
  }
  return void 0;
}
function validateSessionId(sessionId) {
  if (sessionId && !/^[a-zA-Z0-9-_]+$/.test(sessionId)) {
    return `Unusual session ID format. This may cause issues with session resumption.`;
  }
  return void 0;
}

// src/logger.ts
var defaultLogger = {
  // eslint-disable-next-line no-console
  debug: (message) => console.debug(`[DEBUG] ${message}`),
  // eslint-disable-next-line no-console
  info: (message) => console.info(`[INFO] ${message}`),
  warn: (message) => console.warn(`[WARN] ${message}`),
  error: (message) => console.error(`[ERROR] ${message}`)
};
var noopLogger = {
  debug: () => {
  },
  info: () => {
  },
  warn: () => {
  },
  error: () => {
  }
};
function getLogger(logger) {
  if (logger === false) {
    return noopLogger;
  }
  if (logger === void 0) {
    return defaultLogger;
  }
  return logger;
}
function createVerboseLogger(logger, verbose = false) {
  if (verbose) {
    return logger;
  }
  return {
    debug: () => {
    },
    // No-op when not verbose
    info: () => {
    },
    // No-op when not verbose
    warn: logger.warn.bind(logger),
    error: logger.error.bind(logger)
  };
}

// src/claude-code-language-model.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
var CLAUDE_CODE_TRUNCATION_WARNING = "Claude Code SDK output ended unexpectedly; returning truncated response from buffered text. Await upstream fix to avoid data loss.";
var MIN_TRUNCATION_LENGTH = 512;
function isClaudeCodeTruncationError(error, bufferedText) {
  const isSyntaxError = error instanceof SyntaxError || // eslint-disable-next-line @typescript-eslint/no-explicit-any
  typeof error?.name === "string" && // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error.name.toLowerCase() === "syntaxerror";
  if (!isSyntaxError) {
    return false;
  }
  if (!bufferedText) {
    return false;
  }
  const rawMessage = typeof error?.message === "string" ? error.message : "";
  const message = rawMessage.toLowerCase();
  const truncationIndicators = [
    "unexpected end of json input",
    "unexpected end of input",
    "unexpected end of string",
    "unexpected eof",
    "end of file",
    "unterminated string",
    "unterminated string constant"
  ];
  if (!truncationIndicators.some((indicator) => message.includes(indicator))) {
    return false;
  }
  if (bufferedText.length < MIN_TRUNCATION_LENGTH) {
    return false;
  }
  return true;
}
function isAbortError(err) {
  if (err && typeof err === "object") {
    const e = err;
    if (typeof e.name === "string" && e.name === "AbortError") return true;
    if (typeof e.code === "string" && e.code.toUpperCase() === "ABORT_ERR") return true;
  }
  return false;
}
var STREAMING_FEATURE_WARNING = "Claude Agent SDK features (hooks/MCP/images) require streaming input. Set `streamingInput: 'always'` or provide `canUseTool` (auto streams only when canUseTool is set).";
var SDK_OPTIONS_BLOCKLIST = /* @__PURE__ */ new Set(["model", "abortController", "prompt", "outputFormat"]);
function createEmptyUsage() {
  return {
    inputTokens: {
      total: 0,
      noCache: 0,
      cacheRead: 0,
      cacheWrite: 0
    },
    outputTokens: {
      total: 0,
      text: void 0,
      reasoning: void 0
    },
    raw: void 0
  };
}
function convertClaudeCodeUsage(usage) {
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  return {
    inputTokens: {
      total: inputTokens + cacheWrite + cacheRead,
      noCache: inputTokens,
      cacheRead,
      cacheWrite
    },
    outputTokens: {
      total: outputTokens,
      text: void 0,
      reasoning: void 0
    },
    raw: usage
  };
}
function toAsyncIterablePrompt(messagesPrompt, outputStreamEnded, sessionId, contentParts) {
  const content = contentParts && contentParts.length > 0 ? contentParts : [{ type: "text", text: messagesPrompt }];
  const msg = {
    type: "user",
    message: {
      role: "user",
      content
    },
    parent_tool_use_id: null,
    session_id: sessionId ?? ""
  };
  return {
    async *[Symbol.asyncIterator]() {
      yield msg;
      await outputStreamEnded;
    }
  };
}
var modelMap = {
  opus: "opus",
  sonnet: "sonnet",
  haiku: "haiku"
};
var ClaudeCodeLanguageModel = class _ClaudeCodeLanguageModel {
  specificationVersion = "v3";
  defaultObjectGenerationMode = "json";
  supportsImageUrls = false;
  supportedUrls = {};
  supportsStructuredOutputs = true;
  // Fallback/magic string constants
  static UNKNOWN_TOOL_NAME = "unknown-tool";
  // Tool input safety limits
  static MAX_TOOL_INPUT_SIZE = 1048576;
  // 1MB hard limit
  static MAX_TOOL_INPUT_WARN = 102400;
  // 100KB warning threshold
  static MAX_DELTA_CALC_SIZE = 1e4;
  // 10KB delta computation threshold
  modelId;
  settings;
  sessionId;
  modelValidationWarning;
  settingsValidationWarnings;
  logger;
  constructor(options) {
    this.modelId = options.id;
    this.settings = options.settings ?? {};
    this.settingsValidationWarnings = options.settingsValidationWarnings ?? [];
    const baseLogger = getLogger(this.settings.logger);
    this.logger = createVerboseLogger(baseLogger, this.settings.verbose ?? false);
    if (!this.modelId || typeof this.modelId !== "string" || this.modelId.trim() === "") {
      throw new NoSuchModelError({
        modelId: this.modelId,
        modelType: "languageModel"
      });
    }
    this.modelValidationWarning = validateModelId(this.modelId);
    if (this.modelValidationWarning) {
      this.logger.warn(`Claude Code Model: ${this.modelValidationWarning}`);
    }
  }
  get provider() {
    return "claude-code";
  }
  getModel() {
    const mapped = modelMap[this.modelId];
    return mapped ?? this.modelId;
  }
  getSanitizedSdkOptions() {
    if (!this.settings.sdkOptions || typeof this.settings.sdkOptions !== "object") {
      return void 0;
    }
    const sanitized = { ...this.settings.sdkOptions };
    const blockedKeys = Array.from(SDK_OPTIONS_BLOCKLIST).filter((key) => key in sanitized);
    if (blockedKeys.length > 0) {
      this.logger.warn(
        `[claude-code] sdkOptions includes provider-managed fields (${blockedKeys.join(
          ", "
        )}); these will be ignored.`
      );
      blockedKeys.forEach((key) => delete sanitized[key]);
    }
    return sanitized;
  }
  getEffectiveResume(sdkOptions) {
    return sdkOptions?.resume ?? this.settings.resume ?? this.sessionId;
  }
  extractToolUses(content) {
    if (!Array.isArray(content)) {
      return [];
    }
    return content.filter(
      (item) => typeof item === "object" && item !== null && "type" in item && item.type === "tool_use"
    ).map((item) => {
      const { id, name, input } = item;
      return {
        id: typeof id === "string" && id.length > 0 ? id : generateId(),
        name: typeof name === "string" && name.length > 0 ? name : _ClaudeCodeLanguageModel.UNKNOWN_TOOL_NAME,
        input
      };
    });
  }
  extractToolResults(content) {
    if (!Array.isArray(content)) {
      return [];
    }
    return content.filter(
      (item) => typeof item === "object" && item !== null && "type" in item && item.type === "tool_result"
    ).map((item) => {
      const { tool_use_id, content: content2, is_error, name } = item;
      return {
        id: typeof tool_use_id === "string" && tool_use_id.length > 0 ? tool_use_id : generateId(),
        name: typeof name === "string" && name.length > 0 ? name : void 0,
        result: content2,
        isError: Boolean(is_error)
      };
    });
  }
  extractToolErrors(content) {
    if (!Array.isArray(content)) {
      return [];
    }
    return content.filter(
      (item) => typeof item === "object" && item !== null && "type" in item && item.type === "tool_error"
    ).map((item) => {
      const { tool_use_id, error, name } = item;
      return {
        id: typeof tool_use_id === "string" && tool_use_id.length > 0 ? tool_use_id : generateId(),
        name: typeof name === "string" && name.length > 0 ? name : void 0,
        error
      };
    });
  }
  serializeToolInput(input) {
    if (typeof input === "string") {
      return this.checkInputSize(input);
    }
    if (input === void 0) {
      return "";
    }
    try {
      const serialized = JSON.stringify(input);
      return this.checkInputSize(serialized);
    } catch {
      const fallback = String(input);
      return this.checkInputSize(fallback);
    }
  }
  checkInputSize(str) {
    const length = str.length;
    if (length > _ClaudeCodeLanguageModel.MAX_TOOL_INPUT_SIZE) {
      throw new Error(
        `Tool input exceeds maximum size of ${_ClaudeCodeLanguageModel.MAX_TOOL_INPUT_SIZE} bytes (got ${length} bytes). This may indicate a malformed request or an attempt to process excessively large data.`
      );
    }
    if (length > _ClaudeCodeLanguageModel.MAX_TOOL_INPUT_WARN) {
      this.logger.warn(
        `[claude-code] Large tool input detected: ${length} bytes. Performance may be impacted. Consider chunking or reducing input size.`
      );
    }
    return str;
  }
  normalizeToolResult(result) {
    if (typeof result === "string") {
      try {
        return JSON.parse(result);
      } catch {
        return result;
      }
    }
    return result;
  }
  generateAllWarnings(options, prompt) {
    const warnings = [];
    const unsupportedParams = [];
    if (options.temperature !== void 0) unsupportedParams.push("temperature");
    if (options.topP !== void 0) unsupportedParams.push("topP");
    if (options.topK !== void 0) unsupportedParams.push("topK");
    if (options.presencePenalty !== void 0) unsupportedParams.push("presencePenalty");
    if (options.frequencyPenalty !== void 0) unsupportedParams.push("frequencyPenalty");
    if (options.stopSequences !== void 0 && options.stopSequences.length > 0)
      unsupportedParams.push("stopSequences");
    if (options.seed !== void 0) unsupportedParams.push("seed");
    if (unsupportedParams.length > 0) {
      for (const param of unsupportedParams) {
        warnings.push({
          type: "unsupported",
          feature: param,
          details: `Claude Code SDK does not support the ${param} parameter. It will be ignored.`
        });
      }
    }
    if (this.modelValidationWarning) {
      warnings.push({
        type: "other",
        message: this.modelValidationWarning
      });
    }
    this.settingsValidationWarnings.forEach((warning) => {
      warnings.push({
        type: "other",
        message: warning
      });
    });
    if (options.responseFormat?.type === "json" && !options.responseFormat.schema) {
      warnings.push({
        type: "unsupported",
        feature: "responseFormat",
        details: "JSON response format requires a schema for the Claude Code provider. The JSON responseFormat is ignored and the call is treated as plain text."
      });
    }
    const promptWarning = validatePrompt(prompt);
    if (promptWarning) {
      warnings.push({
        type: "other",
        message: promptWarning
      });
    }
    return warnings;
  }
  createQueryOptions(abortController, responseFormat, stderrCollector, sdkOptions, effectiveResume) {
    const opts = {
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
      canUseTool: this.settings.canUseTool
    };
    if (this.settings.systemPrompt !== void 0) {
      opts.systemPrompt = this.settings.systemPrompt;
    } else if (this.settings.customSystemPrompt !== void 0) {
      this.logger.warn(
        "[claude-code] 'customSystemPrompt' is deprecated and will be removed in a future major release. Please use 'systemPrompt' instead (string or { type: 'preset', preset: 'claude_code', append? })."
      );
      opts.systemPrompt = this.settings.customSystemPrompt;
    } else if (this.settings.appendSystemPrompt !== void 0) {
      this.logger.warn(
        "[claude-code] 'appendSystemPrompt' is deprecated and will be removed in a future major release. Please use 'systemPrompt: { type: 'preset', preset: 'claude_code', append: <text> }' instead."
      );
      opts.systemPrompt = {
        type: "preset",
        preset: "claude_code",
        append: this.settings.appendSystemPrompt
      };
    }
    if (this.settings.settingSources !== void 0) {
      opts.settingSources = this.settings.settingSources;
    }
    if (this.settings.additionalDirectories !== void 0) {
      opts.additionalDirectories = this.settings.additionalDirectories;
    }
    if (this.settings.agents !== void 0) {
      opts.agents = this.settings.agents;
    }
    if (this.settings.includePartialMessages !== void 0) {
      opts.includePartialMessages = this.settings.includePartialMessages;
    }
    if (this.settings.fallbackModel !== void 0) {
      opts.fallbackModel = this.settings.fallbackModel;
    }
    if (this.settings.forkSession !== void 0) {
      opts.forkSession = this.settings.forkSession;
    }
    if (this.settings.strictMcpConfig !== void 0) {
      opts.strictMcpConfig = this.settings.strictMcpConfig;
    }
    if (this.settings.extraArgs !== void 0) {
      opts.extraArgs = this.settings.extraArgs;
    }
    if (this.settings.persistSession !== void 0) {
      opts.persistSession = this.settings.persistSession;
    }
    if (this.settings.spawnClaudeCodeProcess !== void 0) {
      opts.spawnClaudeCodeProcess = this.settings.spawnClaudeCodeProcess;
    }
    if (this.settings.hooks) {
      opts.hooks = this.settings.hooks;
    }
    const sdkOverrides = sdkOptions ? sdkOptions : void 0;
    const sdkEnv = sdkOverrides && typeof sdkOverrides.env === "object" && sdkOverrides.env !== null ? sdkOverrides.env : void 0;
    const sdkStderr = sdkOverrides && typeof sdkOverrides.stderr === "function" ? sdkOverrides.stderr : void 0;
    if (sdkOverrides) {
      const rest = { ...sdkOverrides };
      delete rest.env;
      delete rest.stderr;
      Object.assign(opts, rest);
    }
    const userStderrCallback = sdkStderr ?? this.settings.stderr;
    if (stderrCollector || userStderrCallback) {
      opts.stderr = (data) => {
        if (stderrCollector) stderrCollector(data);
        if (userStderrCallback) userStderrCallback(data);
      };
    }
    if (this.settings.env !== void 0 || sdkEnv !== void 0) {
      opts.env = { ...process.env, ...this.settings.env, ...sdkEnv };
    }
    if (responseFormat?.type === "json" && responseFormat.schema) {
      opts.outputFormat = {
        type: "json_schema",
        schema: responseFormat.schema
      };
    }
    return opts;
  }
  handleClaudeCodeError(error, messagesPrompt, collectedStderr) {
    if (isAbortError(error)) {
      throw error;
    }
    const isErrorWithMessage = (err) => {
      return typeof err === "object" && err !== null && "message" in err;
    };
    const isErrorWithCode = (err) => {
      return typeof err === "object" && err !== null;
    };
    const authErrorPatterns = [
      "not logged in",
      "authentication",
      "unauthorized",
      "auth failed",
      "please login",
      "claude login",
      "/login",
      // CLI returns "Please run /login"
      "invalid api key"
    ];
    const errorMessage = isErrorWithMessage(error) && error.message ? error.message.toLowerCase() : "";
    const exitCode = isErrorWithCode(error) && typeof error.exitCode === "number" ? error.exitCode : void 0;
    const isAuthError = authErrorPatterns.some((pattern) => errorMessage.includes(pattern)) || exitCode === 401;
    if (isAuthError) {
      return createAuthenticationError({
        message: isErrorWithMessage(error) && error.message ? error.message : "Authentication failed. Please ensure Claude Code SDK is properly authenticated."
      });
    }
    const errorCode = isErrorWithCode(error) && typeof error.code === "string" ? error.code : "";
    if (errorCode === "ETIMEDOUT" || errorMessage.includes("timeout")) {
      return createTimeoutError({
        message: isErrorWithMessage(error) && error.message ? error.message : "Request timed out",
        promptExcerpt: messagesPrompt.substring(0, 200)
        // Don't specify timeoutMs since we don't know the actual timeout value
        // It's controlled by the consumer via AbortSignal
      });
    }
    const isRetryable = errorCode === "ENOENT" || errorCode === "ECONNREFUSED" || errorCode === "ETIMEDOUT" || errorCode === "ECONNRESET";
    const stderrFromError = isErrorWithCode(error) && typeof error.stderr === "string" ? error.stderr : void 0;
    const stderr = stderrFromError || collectedStderr || void 0;
    return createAPICallError({
      message: isErrorWithMessage(error) && error.message ? error.message : "Claude Code SDK error",
      code: errorCode || void 0,
      exitCode,
      stderr,
      promptExcerpt: messagesPrompt.substring(0, 200),
      isRetryable
    });
  }
  setSessionId(sessionId) {
    this.sessionId = sessionId;
    const warning = validateSessionId(sessionId);
    if (warning) {
      this.logger.warn(`Claude Code Session: ${warning}`);
    }
  }
  async doGenerate(options) {
    this.logger.debug(`[claude-code] Starting doGenerate request with model: ${this.modelId}`);
    this.logger.debug(`[claude-code] Response format: ${options.responseFormat?.type ?? "none"}`);
    const {
      messagesPrompt,
      warnings: messageWarnings,
      streamingContentParts,
      hasImageParts
    } = convertToClaudeCodeMessages(options.prompt);
    this.logger.debug(
      `[claude-code] Converted ${options.prompt.length} messages, hasImageParts: ${hasImageParts}`
    );
    const abortController = new AbortController();
    let abortListener;
    if (options.abortSignal?.aborted) {
      abortController.abort(options.abortSignal.reason);
    } else if (options.abortSignal) {
      abortListener = () => abortController.abort(options.abortSignal?.reason);
      options.abortSignal.addEventListener("abort", abortListener, { once: true });
    }
    let collectedStderr = "";
    const stderrCollector = (data) => {
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
    let text = "";
    let structuredOutput;
    let usage = createEmptyUsage();
    let finishReason = { unified: "stop", raw: void 0 };
    let wasTruncated = false;
    let costUsd;
    let durationMs;
    const warnings = this.generateAllWarnings(options, messagesPrompt);
    if (messageWarnings) {
      messageWarnings.forEach((warning) => {
        warnings.push({
          type: "other",
          message: warning
        });
      });
    }
    const modeSetting = this.settings.streamingInput ?? "auto";
    const effectiveCanUseTool = sdkOptions?.canUseTool ?? this.settings.canUseTool;
    const effectivePermissionPromptToolName = sdkOptions?.permissionPromptToolName ?? this.settings.permissionPromptToolName;
    const wantsStreamInput = modeSetting === "always" || modeSetting === "auto" && !!effectiveCanUseTool;
    if (!wantsStreamInput && hasImageParts) {
      warnings.push({
        type: "other",
        message: STREAMING_FEATURE_WARNING
      });
    }
    let done = () => {
    };
    const outputStreamEnded = new Promise((resolve) => {
      done = () => resolve(void 0);
    });
    try {
      if (effectiveCanUseTool && effectivePermissionPromptToolName) {
        throw new Error(
          "canUseTool requires streamingInput mode ('auto' or 'always') and cannot be used with permissionPromptToolName (SDK constraint). Set streamingInput: 'auto' (or 'always') and remove permissionPromptToolName, or remove canUseTool."
        );
      }
      const sdkPrompt = wantsStreamInput ? toAsyncIterablePrompt(
        messagesPrompt,
        outputStreamEnded,
        effectiveResume,
        streamingContentParts
      ) : messagesPrompt;
      this.logger.debug(
        `[claude-code] Executing query with streamingInput: ${wantsStreamInput}, session: ${effectiveResume ?? "new"}`
      );
      const response = query({
        prompt: sdkPrompt,
        options: queryOptions
      });
      this.settings.onQueryCreated?.(response);
      for await (const message of response) {
        this.logger.debug(`[claude-code] Received message type: ${message.type}`);
        if (message.type === "assistant") {
          text += message.message.content.map((c) => c.type === "text" ? c.text : "").join("");
        } else if (message.type === "result") {
          done();
          this.setSessionId(message.session_id);
          costUsd = message.total_cost_usd;
          durationMs = message.duration_ms;
          if ("is_error" in message && message.is_error === true) {
            const errorMessage = "result" in message && typeof message.result === "string" ? message.result : "Claude Code CLI returned an error";
            throw Object.assign(new Error(errorMessage), { exitCode: 1 });
          }
          if (message.subtype === "error_max_structured_output_retries") {
            throw new Error(
              "Failed to generate valid structured output after maximum retries. The model could not produce a response matching the required schema."
            );
          }
          if ("structured_output" in message && message.structured_output !== void 0) {
            structuredOutput = message.structured_output;
            this.logger.debug("[claude-code] Received structured output from SDK");
          }
          this.logger.info(
            `[claude-code] Request completed - Session: ${message.session_id}, Cost: $${costUsd?.toFixed(4) ?? "N/A"}, Duration: ${durationMs ?? "N/A"}ms`
          );
          if ("usage" in message) {
            usage = convertClaudeCodeUsage(message.usage);
            this.logger.debug(
              `[claude-code] Token usage - Input: ${usage.inputTokens.total}, Output: ${usage.outputTokens.total}`
            );
          }
          finishReason = mapClaudeCodeFinishReason(message.subtype);
          this.logger.debug(`[claude-code] Finish reason: ${finishReason.unified}`);
        } else if (message.type === "system" && message.subtype === "init") {
          this.setSessionId(message.session_id);
          this.logger.info(`[claude-code] Session initialized: ${message.session_id}`);
        }
      }
    } catch (error) {
      done();
      this.logger.debug(
        `[claude-code] Error during doGenerate: ${error instanceof Error ? error.message : String(error)}`
      );
      if (isAbortError(error)) {
        this.logger.debug("[claude-code] Request aborted by user");
        throw options.abortSignal?.aborted ? options.abortSignal.reason : error;
      }
      if (isClaudeCodeTruncationError(error, text)) {
        this.logger.warn(
          `[claude-code] Detected truncated response, returning ${text.length} characters of buffered text`
        );
        wasTruncated = true;
        finishReason = { unified: "length", raw: "truncation" };
        warnings.push({
          type: "other",
          message: CLAUDE_CODE_TRUNCATION_WARNING
        });
      } else {
        throw this.handleClaudeCodeError(error, messagesPrompt, collectedStderr);
      }
    } finally {
      if (options.abortSignal && abortListener) {
        options.abortSignal.removeEventListener("abort", abortListener);
      }
    }
    const finalText = structuredOutput !== void 0 ? JSON.stringify(structuredOutput) : text;
    return {
      content: [{ type: "text", text: finalText }],
      usage,
      finishReason,
      warnings,
      response: {
        id: generateId(),
        timestamp: /* @__PURE__ */ new Date(),
        modelId: this.modelId
      },
      request: {
        body: messagesPrompt
      },
      providerMetadata: {
        "claude-code": {
          ...this.sessionId !== void 0 && { sessionId: this.sessionId },
          ...costUsd !== void 0 && { costUsd },
          ...durationMs !== void 0 && { durationMs },
          ...wasTruncated && { truncated: true }
        }
      }
    };
  }
  async doStream(options) {
    this.logger.debug(`[claude-code] Starting doStream request with model: ${this.modelId}`);
    this.logger.debug(`[claude-code] Response format: ${options.responseFormat?.type ?? "none"}`);
    const {
      messagesPrompt,
      warnings: messageWarnings,
      streamingContentParts,
      hasImageParts
    } = convertToClaudeCodeMessages(options.prompt);
    this.logger.debug(
      `[claude-code] Converted ${options.prompt.length} messages for streaming, hasImageParts: ${hasImageParts}`
    );
    const abortController = new AbortController();
    let abortListener;
    if (options.abortSignal?.aborted) {
      abortController.abort(options.abortSignal.reason);
    } else if (options.abortSignal) {
      abortListener = () => abortController.abort(options.abortSignal?.reason);
      options.abortSignal.addEventListener("abort", abortListener, { once: true });
    }
    let collectedStderr = "";
    const stderrCollector = (data) => {
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
    if (queryOptions.includePartialMessages === void 0) {
      queryOptions.includePartialMessages = true;
    }
    const warnings = this.generateAllWarnings(options, messagesPrompt);
    if (messageWarnings) {
      messageWarnings.forEach((warning) => {
        warnings.push({
          type: "other",
          message: warning
        });
      });
    }
    const modeSetting = this.settings.streamingInput ?? "auto";
    const effectiveCanUseTool = sdkOptions?.canUseTool ?? this.settings.canUseTool;
    const effectivePermissionPromptToolName = sdkOptions?.permissionPromptToolName ?? this.settings.permissionPromptToolName;
    const wantsStreamInput = modeSetting === "always" || modeSetting === "auto" && !!effectiveCanUseTool;
    if (!wantsStreamInput && hasImageParts) {
      warnings.push({
        type: "other",
        message: STREAMING_FEATURE_WARNING
      });
    }
    const stream = new ReadableStream({
      start: async (controller) => {
        let done = () => {
        };
        const outputStreamEnded = new Promise((resolve) => {
          done = () => resolve(void 0);
        });
        const toolStates = /* @__PURE__ */ new Map();
        const streamWarnings = [];
        const closeToolInput = (toolId, state) => {
          if (!state.inputClosed && state.inputStarted) {
            controller.enqueue({
              type: "tool-input-end",
              id: toolId
            });
            state.inputClosed = true;
          }
        };
        const emitToolCall = (toolId, state) => {
          if (state.callEmitted) {
            return;
          }
          closeToolInput(toolId, state);
          controller.enqueue({
            type: "tool-call",
            toolCallId: toolId,
            toolName: state.name,
            input: state.lastSerializedInput ?? "",
            providerExecuted: true,
            dynamic: true,
            // V3 field: indicates tool is provider-defined (not in user's tools map)
            providerMetadata: {
              "claude-code": {
                // rawInput preserves the original serialized format before AI SDK normalization.
                // Use this if you need the exact string sent to the Claude CLI, which may differ
                // from the `input` field after AI SDK processing.
                rawInput: state.lastSerializedInput ?? ""
              }
            }
          });
          state.callEmitted = true;
        };
        const finalizeToolCalls = () => {
          for (const [toolId, state] of toolStates) {
            emitToolCall(toolId, state);
          }
          toolStates.clear();
        };
        let usage = createEmptyUsage();
        let accumulatedText = "";
        let textPartId;
        let streamedTextLength = 0;
        let hasReceivedStreamEvents = false;
        let hasStreamedJson = false;
        try {
          controller.enqueue({ type: "stream-start", warnings });
          if (effectiveCanUseTool && effectivePermissionPromptToolName) {
            throw new Error(
              "canUseTool requires streamingInput mode ('auto' or 'always') and cannot be used with permissionPromptToolName (SDK constraint). Set streamingInput: 'auto' (or 'always') and remove permissionPromptToolName, or remove canUseTool."
            );
          }
          const sdkPrompt = wantsStreamInput ? toAsyncIterablePrompt(
            messagesPrompt,
            outputStreamEnded,
            effectiveResume,
            streamingContentParts
          ) : messagesPrompt;
          this.logger.debug(
            `[claude-code] Starting stream query with streamingInput: ${wantsStreamInput}, session: ${effectiveResume ?? "new"}`
          );
          const response = query({
            prompt: sdkPrompt,
            options: queryOptions
          });
          this.settings.onQueryCreated?.(response);
          for await (const message of response) {
            this.logger.debug(`[claude-code] Stream received message type: ${message.type}`);
            if (message.type === "stream_event") {
              const streamEvent = message;
              const event = streamEvent.event;
              if (event.type === "content_block_delta" && event.delta.type === "text_delta" && "text" in event.delta && event.delta.text) {
                const deltaText = event.delta.text;
                hasReceivedStreamEvents = true;
                if (options.responseFormat?.type === "json") {
                  accumulatedText += deltaText;
                  streamedTextLength += deltaText.length;
                  continue;
                }
                if (!textPartId) {
                  textPartId = generateId();
                  controller.enqueue({
                    type: "text-start",
                    id: textPartId
                  });
                }
                controller.enqueue({
                  type: "text-delta",
                  id: textPartId,
                  delta: deltaText
                });
                accumulatedText += deltaText;
                streamedTextLength += deltaText.length;
              }
              if (event.type === "content_block_delta" && event.delta.type === "input_json_delta" && "partial_json" in event.delta && event.delta.partial_json) {
                const jsonDelta = event.delta.partial_json;
                hasReceivedStreamEvents = true;
                if (options.responseFormat?.type === "json") {
                  if (!textPartId) {
                    textPartId = generateId();
                    controller.enqueue({
                      type: "text-start",
                      id: textPartId
                    });
                  }
                  controller.enqueue({
                    type: "text-delta",
                    id: textPartId,
                    delta: jsonDelta
                  });
                  accumulatedText += jsonDelta;
                  streamedTextLength += jsonDelta.length;
                  hasStreamedJson = true;
                }
              }
              continue;
            }
            if (message.type === "assistant") {
              if (!message.message?.content) {
                this.logger.warn(
                  `[claude-code] Unexpected assistant message structure: missing content field. Message type: ${message.type}. This may indicate an SDK protocol violation.`
                );
                continue;
              }
              const content = message.message.content;
              const tools = this.extractToolUses(content);
              if (textPartId && tools.length > 0) {
                controller.enqueue({
                  type: "text-end",
                  id: textPartId
                });
                textPartId = void 0;
              }
              for (const tool3 of tools) {
                const toolId = tool3.id;
                let state = toolStates.get(toolId);
                if (!state) {
                  state = {
                    name: tool3.name,
                    inputStarted: false,
                    inputClosed: false,
                    callEmitted: false
                  };
                  toolStates.set(toolId, state);
                  this.logger.debug(
                    `[claude-code] New tool use detected - Tool: ${tool3.name}, ID: ${toolId}`
                  );
                }
                state.name = tool3.name;
                if (!state.inputStarted) {
                  this.logger.debug(
                    `[claude-code] Tool input started - Tool: ${tool3.name}, ID: ${toolId}`
                  );
                  controller.enqueue({
                    type: "tool-input-start",
                    id: toolId,
                    toolName: tool3.name,
                    providerExecuted: true,
                    dynamic: true
                    // V3 field: indicates tool is provider-defined
                  });
                  state.inputStarted = true;
                }
                const serializedInput = this.serializeToolInput(tool3.input);
                if (serializedInput) {
                  let deltaPayload = "";
                  if (state.lastSerializedInput === void 0) {
                    if (serializedInput.length <= _ClaudeCodeLanguageModel.MAX_DELTA_CALC_SIZE) {
                      deltaPayload = serializedInput;
                    }
                  } else if (serializedInput.length <= _ClaudeCodeLanguageModel.MAX_DELTA_CALC_SIZE && state.lastSerializedInput.length <= _ClaudeCodeLanguageModel.MAX_DELTA_CALC_SIZE && serializedInput.startsWith(state.lastSerializedInput)) {
                    deltaPayload = serializedInput.slice(state.lastSerializedInput.length);
                  } else if (serializedInput !== state.lastSerializedInput) {
                    deltaPayload = "";
                  }
                  if (deltaPayload) {
                    controller.enqueue({
                      type: "tool-input-delta",
                      id: toolId,
                      delta: deltaPayload
                    });
                  }
                  state.lastSerializedInput = serializedInput;
                }
              }
              const text = content.map((c) => c.type === "text" ? c.text : "").join("");
              if (text) {
                if (hasReceivedStreamEvents) {
                  const newTextStart = streamedTextLength;
                  const deltaText = text.length > newTextStart ? text.slice(newTextStart) : "";
                  accumulatedText = text;
                  if (options.responseFormat?.type !== "json" && deltaText) {
                    if (!textPartId) {
                      textPartId = generateId();
                      controller.enqueue({
                        type: "text-start",
                        id: textPartId
                      });
                    }
                    controller.enqueue({
                      type: "text-delta",
                      id: textPartId,
                      delta: deltaText
                    });
                  }
                  streamedTextLength = text.length;
                } else {
                  accumulatedText += text;
                  if (options.responseFormat?.type !== "json") {
                    if (!textPartId) {
                      textPartId = generateId();
                      controller.enqueue({
                        type: "text-start",
                        id: textPartId
                      });
                    }
                    controller.enqueue({
                      type: "text-delta",
                      id: textPartId,
                      delta: text
                    });
                  }
                }
              }
            } else if (message.type === "user") {
              if (!message.message?.content) {
                this.logger.warn(
                  `[claude-code] Unexpected user message structure: missing content field. Message type: ${message.type}. This may indicate an SDK protocol violation.`
                );
                continue;
              }
              const content = message.message.content;
              for (const result of this.extractToolResults(content)) {
                let state = toolStates.get(result.id);
                const toolName = result.name ?? state?.name ?? _ClaudeCodeLanguageModel.UNKNOWN_TOOL_NAME;
                this.logger.debug(
                  `[claude-code] Tool result received - Tool: ${toolName}, ID: ${result.id}`
                );
                if (!state) {
                  this.logger.warn(
                    `[claude-code] Received tool result for unknown tool ID: ${result.id}`
                  );
                  state = {
                    name: toolName,
                    inputStarted: false,
                    inputClosed: false,
                    callEmitted: false
                  };
                  toolStates.set(result.id, state);
                  if (!state.inputStarted) {
                    controller.enqueue({
                      type: "tool-input-start",
                      id: result.id,
                      toolName,
                      providerExecuted: true,
                      dynamic: true
                      // V3 field: indicates tool is provider-defined
                    });
                    state.inputStarted = true;
                  }
                  if (!state.inputClosed) {
                    controller.enqueue({
                      type: "tool-input-end",
                      id: result.id
                    });
                    state.inputClosed = true;
                  }
                }
                state.name = toolName;
                const normalizedResult = this.normalizeToolResult(result.result);
                const rawResult = typeof result.result === "string" ? result.result : (() => {
                  try {
                    return JSON.stringify(result.result);
                  } catch {
                    return String(result.result);
                  }
                })();
                emitToolCall(result.id, state);
                controller.enqueue({
                  type: "tool-result",
                  toolCallId: result.id,
                  toolName,
                  result: normalizedResult,
                  isError: result.isError,
                  providerExecuted: true,
                  dynamic: true,
                  // V3 field: indicates tool is provider-defined
                  providerMetadata: {
                    "claude-code": {
                      // rawResult preserves the original CLI output string before JSON parsing.
                      // Use this when you need the exact string returned by the tool, especially
                      // if the `result` field has been parsed/normalized and you need the original format.
                      rawResult
                    }
                  }
                });
              }
              for (const error of this.extractToolErrors(content)) {
                let state = toolStates.get(error.id);
                const toolName = error.name ?? state?.name ?? _ClaudeCodeLanguageModel.UNKNOWN_TOOL_NAME;
                this.logger.debug(
                  `[claude-code] Tool error received - Tool: ${toolName}, ID: ${error.id}`
                );
                if (!state) {
                  this.logger.warn(
                    `[claude-code] Received tool error for unknown tool ID: ${error.id}`
                  );
                  state = {
                    name: toolName,
                    inputStarted: true,
                    inputClosed: true,
                    callEmitted: false
                  };
                  toolStates.set(error.id, state);
                }
                emitToolCall(error.id, state);
                const rawError = typeof error.error === "string" ? error.error : typeof error.error === "object" && error.error !== null ? (() => {
                  try {
                    return JSON.stringify(error.error);
                  } catch {
                    return String(error.error);
                  }
                })() : String(error.error);
                controller.enqueue({
                  type: "tool-error",
                  toolCallId: error.id,
                  toolName,
                  error: rawError,
                  providerExecuted: true,
                  dynamic: true,
                  // V3 field: indicates tool is provider-defined
                  providerMetadata: {
                    "claude-code": {
                      rawError
                    }
                  }
                });
              }
            } else if (message.type === "result") {
              done();
              if ("is_error" in message && message.is_error === true) {
                const errorMessage = "result" in message && typeof message.result === "string" ? message.result : "Claude Code CLI returned an error";
                throw Object.assign(new Error(errorMessage), { exitCode: 1 });
              }
              if (message.subtype === "error_max_structured_output_retries") {
                throw new Error(
                  "Failed to generate valid structured output after maximum retries. The model could not produce a response matching the required schema."
                );
              }
              this.logger.info(
                `[claude-code] Stream completed - Session: ${message.session_id}, Cost: $${message.total_cost_usd?.toFixed(4) ?? "N/A"}, Duration: ${message.duration_ms ?? "N/A"}ms`
              );
              if ("usage" in message) {
                usage = convertClaudeCodeUsage(message.usage);
                this.logger.debug(
                  `[claude-code] Stream token usage - Input: ${usage.inputTokens.total}, Output: ${usage.outputTokens.total}`
                );
              }
              const finishReason = mapClaudeCodeFinishReason(
                message.subtype
              );
              this.logger.debug(`[claude-code] Stream finish reason: ${finishReason.unified}`);
              this.setSessionId(message.session_id);
              const structuredOutput = "structured_output" in message ? message.structured_output : void 0;
              const alreadyStreamedJson = hasStreamedJson && options.responseFormat?.type === "json" && hasReceivedStreamEvents;
              if (alreadyStreamedJson) {
                if (textPartId) {
                  controller.enqueue({
                    type: "text-end",
                    id: textPartId
                  });
                }
              } else if (structuredOutput !== void 0) {
                const jsonTextId = generateId();
                const jsonText = JSON.stringify(structuredOutput);
                controller.enqueue({
                  type: "text-start",
                  id: jsonTextId
                });
                controller.enqueue({
                  type: "text-delta",
                  id: jsonTextId,
                  delta: jsonText
                });
                controller.enqueue({
                  type: "text-end",
                  id: jsonTextId
                });
              } else if (textPartId) {
                controller.enqueue({
                  type: "text-end",
                  id: textPartId
                });
              } else if (accumulatedText) {
                const fallbackTextId = generateId();
                controller.enqueue({
                  type: "text-start",
                  id: fallbackTextId
                });
                controller.enqueue({
                  type: "text-delta",
                  id: fallbackTextId,
                  delta: accumulatedText
                });
                controller.enqueue({
                  type: "text-end",
                  id: fallbackTextId
                });
              }
              finalizeToolCalls();
              const warningsJson = this.serializeWarningsForMetadata(streamWarnings);
              controller.enqueue({
                type: "finish",
                finishReason,
                usage,
                providerMetadata: {
                  "claude-code": {
                    sessionId: message.session_id,
                    ...message.total_cost_usd !== void 0 && {
                      costUsd: message.total_cost_usd
                    },
                    ...message.duration_ms !== void 0 && { durationMs: message.duration_ms },
                    // JSON validation warnings are collected during streaming and included
                    // in providerMetadata since the AI SDK's finish event doesn't support
                    // a top-level warnings field (unlike stream-start which was already emitted)
                    ...streamWarnings.length > 0 && {
                      warnings: warningsJson
                    }
                  }
                }
              });
            } else if (message.type === "system" && message.subtype === "init") {
              this.setSessionId(message.session_id);
              this.logger.info(`[claude-code] Stream session initialized: ${message.session_id}`);
              controller.enqueue({
                type: "response-metadata",
                id: message.session_id,
                timestamp: /* @__PURE__ */ new Date(),
                modelId: this.modelId
              });
            }
          }
          finalizeToolCalls();
          this.logger.debug("[claude-code] Stream finalized, closing stream");
          controller.close();
        } catch (error) {
          done();
          this.logger.debug(
            `[claude-code] Error during doStream: ${error instanceof Error ? error.message : String(error)}`
          );
          if (isClaudeCodeTruncationError(error, accumulatedText)) {
            this.logger.warn(
              `[claude-code] Detected truncated stream response, returning ${accumulatedText.length} characters of buffered text`
            );
            const truncationWarning = {
              type: "other",
              message: CLAUDE_CODE_TRUNCATION_WARNING
            };
            streamWarnings.push(truncationWarning);
            if (textPartId) {
              controller.enqueue({
                type: "text-end",
                id: textPartId
              });
            } else if (accumulatedText) {
              const fallbackTextId = generateId();
              controller.enqueue({
                type: "text-start",
                id: fallbackTextId
              });
              controller.enqueue({
                type: "text-delta",
                id: fallbackTextId,
                delta: accumulatedText
              });
              controller.enqueue({
                type: "text-end",
                id: fallbackTextId
              });
            }
            finalizeToolCalls();
            const warningsJson = this.serializeWarningsForMetadata(streamWarnings);
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "length", raw: "truncation" },
              usage,
              providerMetadata: {
                "claude-code": {
                  ...this.sessionId !== void 0 && { sessionId: this.sessionId },
                  truncated: true,
                  ...streamWarnings.length > 0 && {
                    warnings: warningsJson
                  }
                }
              }
            });
            controller.close();
            return;
          }
          finalizeToolCalls();
          let errorToEmit;
          if (isAbortError(error)) {
            errorToEmit = options.abortSignal?.aborted ? options.abortSignal.reason : error;
          } else {
            errorToEmit = this.handleClaudeCodeError(error, messagesPrompt, collectedStderr);
          }
          controller.enqueue({
            type: "error",
            error: errorToEmit
          });
          controller.close();
        } finally {
          if (options.abortSignal && abortListener) {
            options.abortSignal.removeEventListener("abort", abortListener);
          }
        }
      },
      cancel: () => {
        if (options.abortSignal && abortListener) {
          options.abortSignal.removeEventListener("abort", abortListener);
        }
      }
    });
    return {
      stream,
      request: {
        body: messagesPrompt
      }
    };
  }
  serializeWarningsForMetadata(warnings) {
    const result = warnings.map((w) => {
      const base = { type: w.type };
      if ("message" in w) {
        const m = w.message;
        if (m !== void 0) base.message = String(m);
      }
      if (w.type === "unsupported" || w.type === "compatibility") {
        const feature = w.feature;
        if (feature !== void 0) base.feature = String(feature);
        if ("details" in w) {
          const d = w.details;
          if (d !== void 0) base.details = String(d);
        }
      }
      return base;
    });
    return result;
  }
};

// src/claude-code-provider.ts
function createClaudeCode(options = {}) {
  const logger = getLogger(options.defaultSettings?.logger);
  if (options.defaultSettings) {
    const validation = validateSettings(options.defaultSettings);
    if (!validation.valid) {
      throw new Error(`Invalid default settings: ${validation.errors.join(", ")}`);
    }
    if (validation.warnings.length > 0) {
      validation.warnings.forEach((warning) => logger.warn(`Claude Code Provider: ${warning}`));
    }
  }
  const createModel = (modelId, settings = {}) => {
    const mergedSettings = {
      ...options.defaultSettings,
      ...settings
    };
    const validation = validateSettings(mergedSettings);
    if (!validation.valid) {
      throw new Error(`Invalid settings: ${validation.errors.join(", ")}`);
    }
    return new ClaudeCodeLanguageModel({
      id: modelId,
      settings: mergedSettings,
      settingsValidationWarnings: validation.warnings
    });
  };
  const provider = function(modelId, settings) {
    if (new.target) {
      throw new Error("The Claude Code model function cannot be called with the new keyword.");
    }
    return createModel(modelId, settings);
  };
  provider.languageModel = createModel;
  provider.chat = createModel;
  provider.specificationVersion = "v3";
  provider.embeddingModel = (modelId) => {
    throw new NoSuchModelError2({
      modelId,
      modelType: "embeddingModel"
    });
  };
  provider.imageModel = (modelId) => {
    throw new NoSuchModelError2({
      modelId,
      modelType: "imageModel"
    });
  };
  return provider;
}
var claudeCode = createClaudeCode();

// src/index.ts
import { createSdkMcpServer as createSdkMcpServer2, tool as tool2 } from "@anthropic-ai/claude-agent-sdk";

// src/mcp-helpers.ts
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import "zod";
function createCustomMcpServer(config) {
  const defs = Object.entries(config.tools).map(
    ([name, def]) => tool(
      name,
      def.description,
      def.inputSchema.shape,
      (args, extra) => def.handler(args, extra)
    )
  );
  return createSdkMcpServer({ name: config.name, version: config.version, tools: defs });
}
export {
  ClaudeCodeLanguageModel,
  claudeCode,
  createAPICallError,
  createAuthenticationError,
  createClaudeCode,
  createCustomMcpServer,
  createSdkMcpServer2 as createSdkMcpServer,
  createTimeoutError,
  getErrorMetadata,
  isAuthenticationError,
  isTimeoutError,
  tool2 as tool
};
//# sourceMappingURL=index.js.map