import type { LanguageModelV2StreamPart, JSONValue } from '@ai-sdk/provider';
import { generateId } from '@ai-sdk/provider-utils';

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

type ClaudeToolError = {
  id: string;
  name?: string;
  error: unknown;
};

type ToolErrorPart = {
  type: 'tool-error';
  toolCallId: string;
  toolName: string;
  error: string;
  providerExecuted: true;
  providerMetadata?: Record<string, JSONValue>;
};

type ExtendedStreamPart = LanguageModelV2StreamPart | ToolErrorPart;

type ToolStreamState = {
  name: string;
  lastSerializedInput?: string;
  inputStarted: boolean;
  inputClosed: boolean;
  callEmitted: boolean;
};

export class ToolStreamManager {
  private static readonly UNKNOWN_TOOL_NAME = 'unknown-tool';
  private static readonly MAX_TOOL_INPUT_SIZE = 1_048_576;
  private static readonly MAX_TOOL_INPUT_WARN = 102_400;
  private static readonly MAX_DELTA_CALC_SIZE = 10_000;

  private readonly toolStates = new Map<string, ToolStreamState>();
  private readonly logger: (message: string) => void;

  constructor(logger: (message: string) => void) {
    this.logger = logger;
  }

  extractToolUses(content: unknown): ClaudeToolUse[] {
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
        const { id, name, input } = item as { id?: unknown; name?: unknown; input?: unknown };
        return {
          id: typeof id === 'string' && id.length > 0 ? id : generateId(),
          name:
            typeof name === 'string' && name.length > 0 ? name : ToolStreamManager.UNKNOWN_TOOL_NAME,
          input,
        };
      });
  }

  extractToolResults(content: unknown): ClaudeToolResult[] {
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
        };
      });
  }

  extractToolErrors(content: unknown): ClaudeToolError[] {
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

  serializeToolInput(input: unknown): string {
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

  normalizeToolResult(result: unknown): unknown {
    if (typeof result === 'string') {
      try {
        return JSON.parse(result);
      } catch {
        return result;
      }
    }

    return result;
  }

  processToolUse(
    tool: ClaudeToolUse,
    controller: ReadableStreamDefaultController<ExtendedStreamPart>
  ): void {
    const toolId = tool.id;
    let state = this.toolStates.get(toolId);

    if (!state) {
      state = {
        name: tool.name,
        inputStarted: false,
        inputClosed: false,
        callEmitted: false,
      };
      this.toolStates.set(toolId, state);
      this.logger(`New tool use detected - Tool: ${tool.name}, ID: ${toolId}`);
    }

    state.name = tool.name;

    if (!state.inputStarted) {
      this.logger(`Tool input started - Tool: ${tool.name}, ID: ${toolId}`);
      controller.enqueue({
        type: 'tool-input-start',
        id: toolId,
        toolName: tool.name,
        providerExecuted: true,
        dynamic: true,
      } as ExtendedStreamPart);
      state.inputStarted = true;
    }

    const serializedInput = this.serializeToolInput(tool.input);
    if (serializedInput) {
      const deltaPayload = this.calculateDelta(state, serializedInput);

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

  processToolResult(
    result: ClaudeToolResult,
    controller: ReadableStreamDefaultController<ExtendedStreamPart>
  ): void {
    let state = this.toolStates.get(result.id);
    const toolName = result.name ?? state?.name ?? ToolStreamManager.UNKNOWN_TOOL_NAME;

    this.logger(`Tool result received - Tool: ${toolName}, ID: ${result.id}`);

    if (!state) {
      this.logger(`Received tool result for unknown tool ID: ${result.id}`);
      state = this.createSyntheticState(result.id, toolName, controller);
    }

    state.name = toolName;
    const normalizedResult = this.normalizeToolResult(result.result);
    const rawResult = this.stringifyResult(result.result);

    this.emitToolCall(result.id, state, controller);

    controller.enqueue({
      type: 'tool-result',
      toolCallId: result.id,
      toolName,
      result: normalizedResult,
      isError: result.isError,
      providerExecuted: true,
      dynamic: true,
      providerMetadata: {
        'claude-code': { rawResult },
      },
    } as ExtendedStreamPart);
  }

  processToolError(
    error: ClaudeToolError,
    controller: ReadableStreamDefaultController<ExtendedStreamPart>
  ): void {
    let state = this.toolStates.get(error.id);
    const toolName = error.name ?? state?.name ?? ToolStreamManager.UNKNOWN_TOOL_NAME;

    this.logger(`Tool error received - Tool: ${toolName}, ID: ${error.id}`);

    if (!state) {
      this.logger(`Received tool error for unknown tool ID: ${error.id}`);
      state = {
        name: toolName,
        inputStarted: true,
        inputClosed: true,
        callEmitted: false,
      };
      this.toolStates.set(error.id, state);
    }

    this.emitToolCall(error.id, state, controller);

    const rawError = this.stringifyResult(error.error);

    controller.enqueue({
      type: 'tool-error',
      toolCallId: error.id,
      toolName,
      error: rawError,
      providerExecuted: true,
      dynamic: true,
      providerMetadata: {
        'claude-code': { rawError },
      },
    } as ExtendedStreamPart);
  }

  finalizeAllToolCalls(controller: ReadableStreamDefaultController<ExtendedStreamPart>): void {
    for (const [toolId, state] of this.toolStates) {
      this.emitToolCall(toolId, state, controller);
    }
    this.toolStates.clear();
  }

  private checkInputSize(str: string): string {
    const length = str.length;

    if (length > ToolStreamManager.MAX_TOOL_INPUT_SIZE) {
      throw new Error(
        `Tool input exceeds maximum size of ${ToolStreamManager.MAX_TOOL_INPUT_SIZE} bytes (got ${length} bytes)`
      );
    }

    if (length > ToolStreamManager.MAX_TOOL_INPUT_WARN) {
      this.logger(`Large tool input detected: ${length} bytes. Performance may be impacted.`);
    }

    return str;
  }

  private calculateDelta(state: ToolStreamState, serializedInput: string): string {
    if (state.lastSerializedInput === undefined) {
      if (serializedInput.length <= ToolStreamManager.MAX_DELTA_CALC_SIZE) {
        return serializedInput;
      }
      return '';
    }

    if (
      serializedInput.length <= ToolStreamManager.MAX_DELTA_CALC_SIZE &&
      state.lastSerializedInput.length <= ToolStreamManager.MAX_DELTA_CALC_SIZE &&
      serializedInput.startsWith(state.lastSerializedInput)
    ) {
      return serializedInput.slice(state.lastSerializedInput.length);
    }

    if (serializedInput !== state.lastSerializedInput) {
      return '';
    }

    return '';
  }

  private closeToolInput(
    toolId: string,
    state: ToolStreamState,
    controller: ReadableStreamDefaultController<ExtendedStreamPart>
  ): void {
    if (!state.inputClosed && state.inputStarted) {
      controller.enqueue({
        type: 'tool-input-end',
        id: toolId,
      });
      state.inputClosed = true;
    }
  }

  private emitToolCall(
    toolId: string,
    state: ToolStreamState,
    controller: ReadableStreamDefaultController<ExtendedStreamPart>
  ): void {
    if (state.callEmitted) {
      return;
    }

    this.closeToolInput(toolId, state, controller);

    controller.enqueue({
      type: 'tool-call',
      toolCallId: toolId,
      toolName: state.name,
      input: state.lastSerializedInput ?? '',
      providerExecuted: true,
      dynamic: true,
      providerMetadata: {
        'claude-code': {
          rawInput: state.lastSerializedInput ?? '',
        },
      },
    } as ExtendedStreamPart);
    state.callEmitted = true;
  }

  private createSyntheticState(
    toolId: string,
    toolName: string,
    controller: ReadableStreamDefaultController<ExtendedStreamPart>
  ): ToolStreamState {
    const state: ToolStreamState = {
      name: toolName,
      inputStarted: false,
      inputClosed: false,
      callEmitted: false,
    };
    this.toolStates.set(toolId, state);

    if (!state.inputStarted) {
      controller.enqueue({
        type: 'tool-input-start',
        id: toolId,
        toolName,
        providerExecuted: true,
        dynamic: true,
      } as ExtendedStreamPart);
      state.inputStarted = true;
    }

    if (!state.inputClosed) {
      controller.enqueue({
        type: 'tool-input-end',
        id: toolId,
      });
      state.inputClosed = true;
    }

    return state;
  }

  private stringifyResult(result: unknown): string {
    if (typeof result === 'string') {
      return result;
    }

    if (typeof result === 'object' && result !== null) {
      try {
        return JSON.stringify(result);
      } catch {
        return String(result);
      }
    }

    return String(result);
  }
}
