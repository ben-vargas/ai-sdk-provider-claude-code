import type { LanguageModelV1Prompt } from '@ai-sdk/provider';

/**
 * Converts AI SDK prompt format to Claude Code SDK message format.
 * Handles system prompts, user messages, assistant responses, and tool interactions.
 * 
 * @param prompt - The AI SDK prompt containing messages
 * @param mode - Optional mode for specialized output formats (e.g., JSON generation)
 * @returns An object containing the formatted message prompt and optional system prompt
 * 
 * @example
 * ```typescript
 * const { messagesPrompt } = convertToClaudeCodeMessages(
 *   [{ role: 'user', content: 'Hello!' }],
 *   { type: 'regular' }
 * );
 * ```
 * 
 * @remarks
 * - Image inputs are not supported and will be ignored with a warning
 * - Tool calls are simplified to "[Tool calls made]" notation
 * - In 'object-json' mode, explicit JSON instructions are appended
 */
export function convertToClaudeCodeMessages(
  prompt: LanguageModelV1Prompt,
  mode?: { type: 'regular' | 'object-json' | 'object-tool' }
): {
  messagesPrompt: string;
  systemPrompt?: string;
  warnings?: string[];
} {
  const messages: string[] = [];
  const warnings: string[] = [];
  let systemPrompt: string | undefined;

  for (const message of prompt) {
    switch (message.role) {
      case 'system':
        systemPrompt = message.content;
        break;
      
      case 'user':
        if (typeof message.content === 'string') {
          messages.push(message.content);
        } else {
          // Handle multi-part content
          const textParts = message.content
            .filter(part => part.type === 'text')
            .map(part => part.text)
            .join('\n');
          
          if (textParts) {
            messages.push(textParts);
          }
          
          // Note: Image parts are not supported by Claude Code SDK
          const imageParts = message.content.filter(part => part.type === 'image');
          if (imageParts.length > 0) {
            warnings.push('Claude Code SDK does not support image inputs. Images will be ignored.');
          }
        }
        break;
      
      case 'assistant':
        if (typeof message.content === 'string') {
          messages.push(`Assistant: ${message.content}`);
        } else {
          const textParts = message.content
            .filter(part => part.type === 'text')
            .map(part => part.text)
            .join('\n');
          
          if (textParts) {
            messages.push(`Assistant: ${textParts}`);
          }
          
          // Handle tool calls if present
          const toolCalls = message.content.filter(part => part.type === 'tool-call');
          if (toolCalls.length > 0) {
            // For now, we'll just note that tool calls were made
            messages.push(`Assistant: [Tool calls made]`);
          }
        }
        break;
      
      case 'tool':
        // Tool results could be included in the conversation
        messages.push(`Tool Result (${message.content[0].toolName}): ${JSON.stringify(message.content[0].result)}`);
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
  
  if (messages.length === 0) {
    return { messagesPrompt: finalPrompt, systemPrompt };
  }
  
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
    finalPrompt = finalPrompt + '\n\n' + formattedMessages.join('\n\n');
  } else {
    finalPrompt = formattedMessages.join('\n\n');
  }
  
  // For JSON mode, add explicit instruction to ensure JSON output
  if (mode?.type === 'object-json') {
    // Make the JSON instruction even more explicit
    finalPrompt = `${finalPrompt}

CRITICAL INSTRUCTION: You MUST respond with ONLY valid JSON. Follow these rules EXACTLY:
1. Start your response with an opening brace {
2. End your response with a closing brace }
3. Do NOT include any text before the opening brace
4. Do NOT include any text after the closing brace
5. Do NOT use markdown code blocks or backticks
6. Do NOT include explanations or commentary
7. The ENTIRE response must be valid JSON that can be parsed with JSON.parse()

Begin your response with { and end with }`;
  }
  
  return {
    messagesPrompt: finalPrompt,
    systemPrompt,
    ...(warnings.length > 0 && { warnings }),
  };
}