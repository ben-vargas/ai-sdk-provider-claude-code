import type { ModelMessage } from 'ai';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

type SDKUserContentPart = SDKUserMessage['message']['content'][number];

interface StreamingSegment {
  formatted: string;
}

const IMAGE_URL_WARNING = 'Image URLs are not supported by this provider; supply base64/data URLs.';
const IMAGE_CONVERSION_WARNING = 'Unable to convert image content; supply base64/data URLs.';

function normalizeBase64(base64: string): string {
  return base64.replace(/\s+/g, '');
}

function isImageMimeType(mimeType?: string): boolean {
  return typeof mimeType === 'string' && mimeType.trim().toLowerCase().startsWith('image/');
}

function createImageContent(mediaType: string, data: string): SDKUserContentPart | undefined {
  const trimmedType = mediaType.trim();
  const trimmedData = normalizeBase64(data.trim());

  if (!trimmedType || !trimmedData) {
    return undefined;
  }

  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: trimmedType,
      data: trimmedData,
    },
  } as SDKUserContentPart;
}

function extractMimeType(candidate: unknown): string | undefined {
  if (typeof candidate === 'string' && candidate.trim()) {
    return candidate.trim();
  }
  return undefined;
}

function parseObjectImage(
  imageObj: Record<string, unknown>,
  fallbackMimeType?: string
): SDKUserContentPart | undefined {
  const data = typeof imageObj.data === 'string' ? imageObj.data : undefined;
  const mimeType = extractMimeType(
    imageObj.mimeType ?? imageObj.mediaType ?? imageObj.media_type ?? fallbackMimeType
  );
  if (!data || !mimeType) {
    return undefined;
  }
  return createImageContent(mimeType, data);
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

function parseImagePart(part: unknown): { content?: SDKUserContentPart; warning?: string } {
  if (!part || typeof part !== 'object') {
    return { warning: IMAGE_CONVERSION_WARNING };
  }

  const imageValue = (part as { image?: unknown }).image;
  const mimeType = extractMimeType((part as { mimeType?: unknown }).mimeType);

  if (typeof imageValue === 'string') {
    return parseStringImage(imageValue, mimeType);
  }

  if (imageValue && typeof imageValue === 'object') {
    const content = parseObjectImage(imageValue as Record<string, unknown>, mimeType);
    return content ? { content } : { warning: IMAGE_CONVERSION_WARNING };
  }

  return { warning: IMAGE_CONVERSION_WARNING };
}

function convertBinaryToBase64(data: Uint8Array | ArrayBuffer): string | undefined {
  if (typeof Buffer !== 'undefined') {
    const buffer =
      data instanceof Uint8Array ? Buffer.from(data) : Buffer.from(new Uint8Array(data));
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

type FileLikePart = {
  mediaType?: unknown;
  mimeType?: unknown;
  data?: unknown;
};

function parseFilePart(part: FileLikePart): { content?: SDKUserContentPart; warning?: string } {
  const mimeType = extractMimeType(part.mediaType ?? part.mimeType);
  if (!mimeType || !isImageMimeType(mimeType)) {
    return {};
  }

  const data = part.data;
  if (typeof data === 'string') {
    const content = createImageContent(mimeType, data);
    return content ? { content } : { warning: IMAGE_CONVERSION_WARNING };
  }

  if (
    data instanceof Uint8Array ||
    (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer)
  ) {
    const base64 = convertBinaryToBase64(data);
    if (!base64) {
      return { warning: IMAGE_CONVERSION_WARNING };
    }
    const content = createImageContent(mimeType, base64);
    return content ? { content } : { warning: IMAGE_CONVERSION_WARNING };
  }

  return { warning: IMAGE_CONVERSION_WARNING };
}

/**
 * Converts AI SDK prompt format to Claude Code SDK message format.
 * Handles system prompts, user messages, assistant responses, and tool interactions.
 *
 * @param prompt - The AI SDK prompt containing messages
 * @returns An object containing the formatted message prompt and optional system prompt
 *
 * @example
 * ```typescript
 * const { messagesPrompt } = convertToClaudeCodeMessages(
 *   [{ role: 'user', content: 'Hello!' }]
 * );
 * ```
 *
 * @remarks
 * - Image parts are collected for streaming input; unsupported variants produce warnings
 * - Tool calls are simplified to "[Tool calls made]" notation
 * - JSON schema enforcement is handled natively by the SDK's outputFormat option (v0.1.45+)
 */
export function convertToClaudeCodeMessages(prompt: readonly ModelMessage[]): {
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

  for (const message of prompt) {
    switch (message.role) {
      case 'system':
        systemPrompt = message.content;
        if (typeof message.content === 'string' && message.content.trim().length > 0) {
          addSegment(message.content);
        } else {
          addSegment('');
        }
        break;

      case 'user':
        if (typeof message.content === 'string') {
          messages.push(message.content);
          addSegment(`Human: ${message.content}`);
        } else {
          // Handle multi-part content
          const textParts = message.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('\n');

          const segmentIndex = addSegment(textParts ? `Human: ${textParts}` : '');

          if (textParts) {
            messages.push(textParts);
          }

          for (const part of message.content) {
            if (part.type === 'image') {
              const { content, warning } = parseImagePart(part);
              if (content) {
                addImageForSegment(segmentIndex, content);
              } else if (warning) {
                warnings.push(warning);
              }
            } else if (part.type === 'file') {
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

      case 'assistant': {
        let assistantContent = '';
        if (typeof message.content === 'string') {
          assistantContent = message.content;
        } else {
          const textParts = message.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('\n');

          if (textParts) {
            assistantContent = textParts;
          }

          // Handle tool calls if present
          const toolCalls = message.content.filter((part) => part.type === 'tool-call');
          if (toolCalls.length > 0) {
            // For now, we'll just note that tool calls were made
            assistantContent += `\n[Tool calls made]`;
          }
        }
        const formattedAssistant = `Assistant: ${assistantContent}`;
        messages.push(formattedAssistant);
        addSegment(formattedAssistant);
        break;
      }

      case 'tool':
        // Tool results could be included in the conversation
        for (const tool of message.content) {
          const resultText =
            tool.output.type === 'text' ? tool.output.value : JSON.stringify(tool.output.value);
          const formattedToolResult = `Tool Result (${tool.toolName}): ${resultText}`;
          messages.push(formattedToolResult);
          addSegment(formattedToolResult);
        }
        break;
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
    // Format messages
    const formattedMessages = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      // Check if this is a user or assistant message based on content
      if (msg.startsWith('Assistant:') || msg.startsWith('Tool Result')) {
        formattedMessages.push(msg);
      } else {
        // User messages
        formattedMessages.push(`Human: ${msg}`);
      }
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
