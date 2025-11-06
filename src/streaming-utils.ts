import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

export class StreamingUtils {
  static toAsyncIterablePrompt(
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

  static shouldUseStreamingInput(
    streamingInputMode: 'always' | 'auto' | 'off' | undefined,
    hasCanUseTool: boolean
  ): boolean {
    const modeSetting = streamingInputMode ?? 'auto';
    return modeSetting === 'always' || (modeSetting === 'auto' && hasCanUseTool);
  }

  static validateStreamingRequirements(
    canUseTool?: unknown,
    permissionPromptToolName?: unknown
  ): void {
    if (canUseTool && permissionPromptToolName) {
      throw new Error(
        "canUseTool requires streamingInput mode ('auto' or 'always') and cannot be used with permissionPromptToolName (SDK constraint). Set streamingInput: 'auto' (or 'always') and remove permissionPromptToolName, or remove canUseTool."
      );
    }
  }
}
