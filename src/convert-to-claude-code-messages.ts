import type {
  LanguageModelV4FilePart,
  LanguageModelV4Prompt,
  LanguageModelV4ToolResultOutput,
} from '@ai-sdk/provider';
import { detectMediaType } from '@ai-sdk/provider-utils';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

type SDKUserContentPart = SDKUserMessage['message']['content'][number];
type ToolResultContentPart = Extract<
  LanguageModelV4ToolResultOutput,
  { type: 'content' }
>['value'][number];
type ToolResultFilePart = Extract<ToolResultContentPart, { type: 'file' }>;
type FileLikePart = LanguageModelV4FilePart | ToolResultFilePart;

interface StreamingSegment {
  formatted: string;
}

interface FileConversionResult {
  content?: SDKUserContentPart;
  text?: string;
  warning?: string;
}

const IMAGE_URL_WARNING = 'Image URLs are not supported by this provider; supply base64/data URLs.';
const IMAGE_CONVERSION_WARNING = 'Unable to convert image content; supply base64/data URLs.';
const FILE_REFERENCE_WARNING =
  'Provider file references are not supported by this provider; supply inline file data.';

/**
 * Maximum serialized length for a single tool-call input when replaying
 * conversation history. Mirrors the spirit of the model's tool-result
 * truncation (maxToolResultSize): the live turn saw the full data, history
 * replay only needs enough context to stay coherent. Inputs longer than this
 * are cut and suffixed with '...[truncated]'.
 */
const MAX_TOOL_CALL_INPUT_LENGTH = 1000;

/**
 * Serializes a tool-call input to a bounded JSON string for history replay.
 * Non-JSON-serializable inputs fall back to String(); oversized payloads are
 * truncated at MAX_TOOL_CALL_INPUT_LENGTH with a '...[truncated]' suffix.
 */
function serializeToolCallInput(input: unknown): string {
  let serialized: string;
  if (input === undefined) {
    serialized = '';
  } else {
    try {
      serialized = JSON.stringify(input) ?? String(input);
    } catch {
      serialized = String(input);
    }
  }

  if (serialized.length > MAX_TOOL_CALL_INPUT_LENGTH) {
    return `${serialized.slice(0, MAX_TOOL_CALL_INPUT_LENGTH)}...[truncated]`;
  }
  return serialized;
}

function getVariantName(value: unknown, discriminator: 'type' | 'role'): string {
  if (typeof value === 'object' && value !== null) {
    const candidate = (value as Record<string, unknown>)[discriminator];
    if (typeof candidate === 'string' && candidate) {
      return candidate;
    }
  }
  return String(value);
}

function createUnknownPromptVariantWarning(
  value: unknown,
  context: string,
  discriminator: 'type' | 'role' = 'type'
): string {
  return `Unsupported ${context} ${discriminator} '${getVariantName(
    value,
    discriminator
  )}' was skipped.`;
}

function extractMimeType(candidate: unknown): string | undefined {
  if (typeof candidate === 'string' && candidate.trim()) {
    return candidate.trim();
  }
  return undefined;
}

function normalizeMediaType(mediaType: string): string {
  return mediaType.trim().toLowerCase();
}

function isImageMimeType(mediaType?: string): boolean {
  if (!mediaType) {
    return false;
  }
  const normalized = normalizeMediaType(mediaType);
  return normalized === 'image' || normalized === 'image/*' || normalized.startsWith('image/');
}

function isConcreteImageMimeType(mediaType: string): boolean {
  const normalized = normalizeMediaType(mediaType);
  return normalized.startsWith('image/') && !normalized.endsWith('/*');
}

function resolveImageMediaType(mediaType: string, data?: Uint8Array | string): string | undefined {
  const normalizedMediaType = normalizeMediaType(mediaType);

  if (isConcreteImageMimeType(normalizedMediaType)) {
    return normalizedMediaType;
  }

  if ((normalizedMediaType === 'image' || normalizedMediaType === 'image/*') && data) {
    try {
      const detectedMediaType = detectMediaType({ data, topLevelType: 'image' });
      if (detectedMediaType && isConcreteImageMimeType(detectedMediaType)) {
        return detectedMediaType;
      }
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function createImageContent(mediaType: string, data: string): SDKUserContentPart | undefined {
  const normalizedType = normalizeMediaType(mediaType);
  const trimmedData = data.trim().replace(/\s+/g, '');

  if (!isConcreteImageMimeType(normalizedType) || !trimmedData) {
    return undefined;
  }

  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: normalizedType,
      data: trimmedData,
    },
  } as SDKUserContentPart;
}

function resolveStringImageMediaType(
  mediaType: string,
  data: string,
  fallbackMimeType?: string
): string | undefined {
  return (
    resolveImageMediaType(mediaType, data) ??
    (fallbackMimeType ? resolveImageMediaType(fallbackMimeType, data) : undefined)
  );
}

function parseStringImage(
  value: string,
  fallbackMimeType?: string
): { content?: SDKUserContentPart; warning?: string } {
  const trimmed = value.trim();

  if (/^https?:\/\//i.test(trimmed)) {
    return { warning: IMAGE_URL_WARNING };
  }

  const dataUrlMatch = trimmed.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    const [, mediaType, data] = dataUrlMatch;
    const resolvedMediaType = resolveStringImageMediaType(mediaType, data, fallbackMimeType);
    const content = resolvedMediaType ? createImageContent(resolvedMediaType, data) : undefined;
    return content ? { content } : { warning: IMAGE_CONVERSION_WARNING };
  }

  const base64Match = trimmed.match(/^base64:([^,]+),(.+)$/i);
  if (base64Match) {
    const [, explicitMimeType, data] = base64Match;
    const resolvedMediaType = resolveStringImageMediaType(explicitMimeType, data, fallbackMimeType);
    const content = resolvedMediaType ? createImageContent(resolvedMediaType, data) : undefined;
    return content ? { content } : { warning: IMAGE_CONVERSION_WARNING };
  }

  if (fallbackMimeType) {
    const resolvedMediaType = resolveImageMediaType(fallbackMimeType, trimmed);
    if (resolvedMediaType) {
      const content = createImageContent(resolvedMediaType, trimmed);
      if (content) {
        return { content };
      }
    }
  }

  return { warning: IMAGE_CONVERSION_WARNING };
}

function convertBinaryToBase64(data: Uint8Array | ArrayBuffer): string | undefined {
  if (typeof Buffer !== 'undefined') {
    const buffer =
      data instanceof Uint8Array
        ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
        : Buffer.from(data);
    return buffer.toString('base64');
  }

  if (typeof btoa === 'function') {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  return undefined;
}

function parseFilePart(part: FileLikePart): FileConversionResult {
  const mediaType = extractMimeType(part.mediaType);
  const fileData = part.data;

  switch (fileData.type) {
    case 'data': {
      if (!mediaType || !isImageMimeType(mediaType)) {
        return {};
      }

      if (typeof fileData.data === 'string') {
        return parseStringImage(fileData.data, mediaType);
      }

      const resolvedMediaType = resolveImageMediaType(mediaType, fileData.data);
      if (!resolvedMediaType) {
        return { warning: IMAGE_CONVERSION_WARNING };
      }

      const base64 = convertBinaryToBase64(fileData.data);
      if (!base64) {
        return { warning: IMAGE_CONVERSION_WARNING };
      }
      const content = createImageContent(resolvedMediaType, base64);
      return content ? { content } : { warning: IMAGE_CONVERSION_WARNING };
    }

    case 'url': {
      if (!mediaType || !isImageMimeType(mediaType)) {
        return {};
      }
      return parseStringImage(fileData.url.toString(), mediaType);
    }

    case 'text':
      return fileData.text ? { text: fileData.text } : {};

    case 'reference':
      return { warning: FILE_REFERENCE_WARNING };

    default: {
      const unknownFileData: never = fileData;
      return {
        warning: createUnknownPromptVariantWarning(unknownFileData, 'prompt file data'),
      };
    }
  }
}

function serializeToolResultFilePart(
  part: ToolResultFilePart,
  warnings: string[]
): string | undefined {
  const fileData = part.data;
  const fileLabel = part.filename ? `File ${part.filename}` : 'File';

  switch (fileData.type) {
    case 'data':
      return `[${fileLabel}: ${part.mediaType}]`;

    case 'url':
      return `[${fileLabel}: ${part.mediaType}: ${fileData.url.toString()}]`;

    case 'text':
      return fileData.text;

    case 'reference':
      warnings.push(FILE_REFERENCE_WARNING);
      return undefined;

    default: {
      const unknownFileData: never = fileData;
      warnings.push(createUnknownPromptVariantWarning(unknownFileData, 'tool result file data'));
      return undefined;
    }
  }
}

function serializeToolResultContentPart(
  part: ToolResultContentPart,
  warnings: string[]
): string | undefined {
  switch (part.type) {
    case 'text':
      return part.text;

    case 'file':
      return serializeToolResultFilePart(part, warnings);

    case 'custom':
      // Provider-specific rich content cannot be represented in Claude Code replay text.
      return undefined;

    default: {
      const unknownPart: never = part;
      warnings.push(createUnknownPromptVariantWarning(unknownPart, 'tool result content part'));
      return undefined;
    }
  }
}

function serializeToolResultOutput(
  output: LanguageModelV4ToolResultOutput,
  warnings: string[]
): string | undefined {
  switch (output.type) {
    case 'text':
    case 'error-text':
      return output.value;

    case 'json':
    case 'error-json':
      return JSON.stringify(output.value) ?? String(output.value);

    case 'execution-denied':
      return `[Execution denied${output.reason ? `: ${output.reason}` : ''}]`;

    case 'content':
      return output.value
        .map((part) => serializeToolResultContentPart(part, warnings))
        .filter((text): text is string => typeof text === 'string' && text.length > 0)
        .join('\n');

    default: {
      const unknownOutput: never = output;
      warnings.push(createUnknownPromptVariantWarning(unknownOutput, 'tool result output'));
      return undefined;
    }
  }
}

/**
 * Converts AI SDK provider prompt format to Claude Code SDK message format.
 * Handles system prompts, user messages, assistant responses, and tool interactions.
 *
 * @param prompt - The AI SDK LanguageModelV4 prompt containing messages
 * @returns An object containing the formatted message prompt and optional system prompt
 *
 * @example
 * ```typescript
 * const { messagesPrompt } = convertToClaudeCodeMessages(
 *   [{ role: 'user', content: [{ type: 'text', text: 'Hello!' }] }]
 * );
 * ```
 *
 * @remarks
 * - Image parts are collected for streaming input; unsupported variants produce warnings
 * - Tool calls are serialized one per line as `[Tool call: name({...input})]`
 *   (inputs truncated at 1000 characters), pairing with `Tool Result (name): ...` lines
 * - JSON schema enforcement is handled natively by the SDK's outputFormat option (v0.1.45+)
 */
export function convertToClaudeCodeMessages(prompt: LanguageModelV4Prompt): {
  messagesPrompt: string;
  systemPrompt?: string;
  warnings?: string[];
  streamingContentParts: SDKUserMessage['message']['content'];
  hasImageParts: boolean;
} {
  const messages: string[] = [];
  const warnings: string[] = [];
  let systemPrompt: string | undefined;
  const streamingSegments: StreamingSegment[] = [];
  const imageMap = new Map<number, SDKUserContentPart[]>();
  let hasImageParts = false;

  const addSegment = (formatted: string): number => {
    streamingSegments.push({ formatted });
    return streamingSegments.length - 1;
  };

  const addImageForSegment = (segmentIndex: number, content: SDKUserContentPart): void => {
    hasImageParts = true;
    if (!imageMap.has(segmentIndex)) {
      imageMap.set(segmentIndex, []);
    }
    imageMap.get(segmentIndex)?.push(content);
  };

  const addWarning = (warning?: string): void => {
    if (warning) {
      warnings.push(warning);
    }
  };

  for (const message of prompt) {
    switch (message.role) {
      case 'system':
        systemPrompt =
          systemPrompt === undefined ? message.content : `${systemPrompt}\n\n${message.content}`;
        if (message.content.trim().length > 0) {
          addSegment(message.content);
        } else {
          addSegment('');
        }
        break;

      case 'user': {
        const textParts: string[] = [];
        const imageParts: SDKUserContentPart[] = [];

        for (const part of message.content) {
          switch (part.type) {
            case 'text':
              if (typeof part.text === 'string') {
                textParts.push(part.text);
              }
              break;

            case 'file': {
              const { content, text, warning } = parseFilePart(part);
              if (typeof text === 'string') {
                textParts.push(text);
              }
              if (content) {
                imageParts.push(content);
              }
              addWarning(warning);
              break;
            }

            default: {
              const unknownPart: never = part;
              addWarning(
                createUnknownPromptVariantWarning(unknownPart, 'prompt user content part')
              );
              break;
            }
          }
        }

        const textContent = textParts.join('\n');
        const segmentIndex = addSegment(textContent ? `Human: ${textContent}` : '');

        if (textContent) {
          messages.push(`Human: ${textContent}`);
        }

        for (const imagePart of imageParts) {
          addImageForSegment(segmentIndex, imagePart);
        }
        break;
      }

      case 'assistant': {
        const assistantParts: string[] = [];
        const imageParts: SDKUserContentPart[] = [];

        for (const part of message.content) {
          switch (part.type) {
            case 'text':
              if (typeof part.text === 'string') {
                assistantParts.push(part.text);
              }
              break;

            case 'tool-call':
              assistantParts.push(
                `[Tool call: ${part.toolName}(${serializeToolCallInput(part.input)})]`
              );
              break;

            case 'tool-result': {
              const output = serializeToolResultOutput(part.output, warnings);
              if (output !== undefined) {
                assistantParts.push(`Tool Result (${part.toolName}): ${output}`);
              }
              break;
            }

            case 'file': {
              const { content, text, warning } = parseFilePart(part);
              if (typeof text === 'string') {
                assistantParts.push(text);
              }
              if (content) {
                imageParts.push(content);
              }
              addWarning(warning);
              break;
            }

            case 'reasoning':
              // Reasoning text is intentionally omitted from replay prompts.
              break;

            case 'reasoning-file':
              // Reasoning files have no Claude Code replay representation.
              break;

            case 'custom':
              // Provider-specific assistant content has no Claude Code replay representation.
              break;

            default: {
              const unknownPart: never = part;
              addWarning(
                createUnknownPromptVariantWarning(unknownPart, 'prompt assistant content part')
              );
              break;
            }
          }
        }

        const assistantContent = assistantParts.join('\n');
        const formattedAssistant = `Assistant: ${assistantContent}`;
        messages.push(formattedAssistant);
        const segmentIndex = addSegment(formattedAssistant);
        for (const imagePart of imageParts) {
          addImageForSegment(segmentIndex, imagePart);
        }
        break;
      }

      case 'tool':
        for (const tool of message.content) {
          switch (tool.type) {
            case 'tool-result': {
              const output = serializeToolResultOutput(tool.output, warnings);
              if (output !== undefined) {
                const formattedToolResult = `Tool Result (${tool.toolName}): ${output}`;
                messages.push(formattedToolResult);
                addSegment(formattedToolResult);
              }
              break;
            }

            case 'tool-approval-response':
              // Approval responses are control-plane metadata and are omitted from replay text.
              break;

            default: {
              const unknownPart: never = tool;
              addWarning(
                createUnknownPromptVariantWarning(unknownPart, 'prompt tool content part')
              );
              break;
            }
          }
        }
        break;

      default: {
        const unknownMessage: never = message;
        addWarning(createUnknownPromptVariantWarning(unknownMessage, 'prompt message', 'role'));
        break;
      }
    }
  }

  // For the SDK, we need to provide a single prompt string
  // Format the conversation history properly

  // Combine system prompt with messages
  let finalPrompt = '';

  // Add system prompt at the beginning if present
  if (systemPrompt) {
    finalPrompt = systemPrompt;
  }

  if (messages.length > 0) {
    // Messages are role-tagged at the point they are collected. Do not infer
    // role from text prefixes: user-authored content may legitimately start
    // with "Assistant:" or "Tool Result".
    const formattedMessages: string[] = [];
    for (let i = 0; i < messages.length; i++) {
      formattedMessages.push(messages[i]);
    }

    // Combine system prompt with messages
    if (finalPrompt) {
      const joinedMessages = formattedMessages.join('\n\n');
      finalPrompt = joinedMessages ? `${finalPrompt}\n\n${joinedMessages}` : finalPrompt;
    } else {
      finalPrompt = formattedMessages.join('\n\n');
    }
  }

  // Build streaming parts including text and images
  const streamingParts: SDKUserContentPart[] = [];
  const imagePartsInOrder: SDKUserContentPart[] = [];

  const appendImagesForIndex = (index: number) => {
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
    let accumulatedText = '';
    let emittedText = false;

    const flushText = () => {
      if (!accumulatedText) {
        return;
      }
      streamingParts.push({ type: 'text', text: accumulatedText });
      accumulatedText = '';
      emittedText = true;
    };

    streamingSegments.forEach((segment, index) => {
      const segmentText = segment.formatted;
      if (segmentText) {
        if (!accumulatedText) {
          accumulatedText = emittedText ? `\n\n${segmentText}` : segmentText;
        } else {
          accumulatedText += `\n\n${segmentText}`;
        }
      }

      if (imageMap.has(index)) {
        flushText();
        appendImagesForIndex(index);
      }
    });

    flushText();
  }

  // Note: JSON schema enforcement is now handled natively by the SDK's outputFormat option (v0.1.45+)
  // No prompt injection needed - structured outputs are guaranteed by the SDK

  return {
    messagesPrompt: finalPrompt,
    systemPrompt,
    ...(warnings.length > 0 && { warnings }),
    streamingContentParts:
      streamingParts.length > 0
        ? (streamingParts as SDKUserMessage['message']['content'])
        : ([
            { type: 'text', text: finalPrompt },
            ...imagePartsInOrder,
          ] as SDKUserMessage['message']['content']),
    hasImageParts,
  };
}
