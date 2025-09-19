import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeCodeLanguageModel } from './claude-code-language-model.js';
import type { LanguageModelV2StreamPart } from '@ai-sdk/provider';

// Mock the SDK module with factory function
vi.mock('@anthropic-ai/claude-code', () => {
  return {
    query: vi.fn(),
    // Note: real SDK may not export AbortError at runtime; test mock provides it
    AbortError: class AbortError extends Error { constructor(message?: string) { super(message); this.name = 'AbortError'; } },
  };
});

// Import the mocked module to get typed references
import { query as mockQuery, AbortError as MockAbortError } from '@anthropic-ai/claude-code';
import type { SDKUserMessage } from '@anthropic-ai/claude-code';

const STREAMING_WARNING_MESSAGE = "Claude Code SDK features (hooks/MCP/images) require streaming input. Set `streamingInput: 'always'` or provide `canUseTool` (auto streams only when canUseTool is set).";

describe('ClaudeCodeLanguageModel', () => {
  let model: ClaudeCodeLanguageModel;

  beforeEach(() => {
    vi.clearAllMocks();
    
    model = new ClaudeCodeLanguageModel({
      id: 'sonnet',
      settings: {},
    });
  });

  describe('doGenerate', () => {
    it('uses AsyncIterable prompt when streamingInput auto and canUseTool provided', async () => {
      const hooks = {} as any;
      const canUseTool = async () => ({ behavior: 'allow', updatedInput: {} });
      const modelWithStream = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { hooks, canUseTool, streamingInput: 'auto' } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'result', subtype: 'success', session_id: 's2', usage: { input_tokens: 0, output_tokens: 0 } };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithStream.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(call).toBeDefined();
      // AsyncIterable check
      expect(typeof call.prompt?.[Symbol.asyncIterator]).toBe('function');
    });

    it('includes image content in streaming prompts when enabled', async () => {
      const modelWithImages = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { streamingInput: 'always' } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'img-session',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };

      let promptContentPromise: Promise<any> | undefined;

      const isAsyncIterable = (value: unknown): value is AsyncIterable<unknown> => {
        return Boolean(
          value &&
          typeof value === 'object' &&
          Symbol.asyncIterator in value &&
          typeof (value as Record<PropertyKey, unknown>)[Symbol.asyncIterator] === 'function'
        );
      };

      vi.mocked(mockQuery).mockImplementation(({ prompt }) => {
        if (isAsyncIterable(prompt)) {
          const iterator = prompt[Symbol.asyncIterator]();
          promptContentPromise = iterator.next().then(({ value }) => (value as SDKUserMessage | undefined)?.message?.content);
        }
        return mockResponse as any;
      });

      await modelWithImages.doGenerate({
        prompt: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this image.' },
              { type: 'image', image: 'data:image/png;base64,aGVsbG8=' },
            ],
          },
        ],
      } as any);

      expect(promptContentPromise).toBeDefined();
      const content = await promptContentPromise!;
      expect(Array.isArray(content)).toBe(true);
      expect(content).toHaveLength(2);
      expect(content[0]).toEqual({ type: 'text', text: 'Human: Describe this image.' });
      expect(content[1]).toEqual({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'aGVsbG8=',
        },
      });
    });

    it('keeps string prompt when streamingInput off even if canUseTool provided', async () => {
      const modelWithOff = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }), streamingInput: 'off' } as any,
      });
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'result', subtype: 'success', session_id: 's3', usage: { input_tokens: 0, output_tokens: 0 } };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithOff.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0];
      expect(typeof call.prompt).toBe('string');
    });

    it('throws when canUseTool is combined with permissionPromptToolName', async () => {
      const model = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
          permissionPromptToolName: 'stdio',
          streamingInput: 'auto',
        } as any,
      });

      const promise = model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);
      await expect(promise).rejects.toThrow(/cannot be used with permissionPromptToolName/);
    });
    it('should pass through hooks and canUseTool to SDK query options', async () => {
      const preToolHook = async () => ({ continue: true });
      const hooks = { PreToolUse: [{ hooks: [preToolHook] }] } as any;
      const canUseTool = async () => ({ behavior: 'allow', updatedInput: {} });

      const modelWithCallbacks = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { hooks, canUseTool } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'result', subtype: 'success', session_id: 's1', usage: { input_tokens: 0, output_tokens: 0 } };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelWithCallbacks.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      expect(vi.mocked(mockQuery)).toHaveBeenCalled();
      const call = vi.mocked(mockQuery).mock.calls[0]?.[0];
      expect(call?.options?.hooks).toBe(hooks);
      expect(call?.options?.canUseTool).toBe(canUseTool);
    });
    it('should generate text from SDK response', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'system',
            subtype: 'init',
            session_id: 'test-session-123',
          };
          yield {
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'Hello, ' },
                { type: 'text', text: 'world!' },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'test-session-123',
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
            total_cost_usd: 0.001,
            duration_ms: 1000,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Say hello' }] }],
      });

      expect(result.content).toEqual([{ type: 'text', text: 'Hello, world!' }]);
      expect(result.usage).toEqual({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      });
      expect(result.finishReason).toBe('stop');
    });

    it('should handle error_max_turns as length finish reason', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'Partial response' }],
            },
          };
          yield {
            type: 'result',
            subtype: 'error_max_turns',
            session_id: 'test-session-123',
            usage: {
              input_tokens: 100,
              output_tokens: 50,
            },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Complex task' }] }],
      });

      expect(result.finishReason).toBe('length');
    });

    it('should handle AbortError correctly', async () => {
      const abortController = new AbortController();
      const abortReason = new Error('User cancelled');
      
      // Set up the mock to throw AbortError when called
      vi.mocked(mockQuery).mockImplementation(() => {
        throw new MockAbortError('Operation aborted');
      });

      // Abort before calling to ensure signal.aborted is true
      abortController.abort(abortReason);

      const promise = model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test abort' }] }],
        abortSignal: abortController.signal,
      });

      // Should throw the abort reason since signal is aborted
      await expect(promise).rejects.toThrow(abortReason);
    });
  });

  describe('doStream', () => {
    it('should stream text chunks from SDK response', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'Hello' }],
            },
          };
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: ', world!' }],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'test-session-123',
            usage: {
              input_tokens: 10,
              output_tokens: 5,
            },
            total_cost_usd: 0.001,
            duration_ms: 1000,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Say hello' }] }],
      });

      const chunks: any[] = [];
      const reader = result.stream.getReader();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      expect(chunks).toHaveLength(6);
      expect(chunks[0]).toMatchObject({
        type: 'stream-start',
        warnings: [],
      });
      expect(chunks[1]).toMatchObject({
        type: 'text-start',
      });
      expect(chunks[2]).toMatchObject({
        type: 'text-delta',
        delta: 'Hello',
      });
      expect(chunks[3]).toMatchObject({
        type: 'text-delta',
        delta: ', world!',
      });
      expect(chunks[4]).toMatchObject({
        type: 'text-end',
      });
      expect(chunks[5]).toMatchObject({
        type: 'finish',
        finishReason: 'stop',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
      });
    });

    it('emits streaming prerequisite warning when images are provided without streaming input', async () => {
      const modelWithStreamingOff = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: { streamingInput: 'off' } as any,
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'warn-session',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await modelWithStreamingOff.doStream({
        prompt: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Look at this image.' },
              { type: 'image', image: 'data:image/png;base64,aGVsbG8=' },
            ],
          },
        ],
      } as any);

      const reader = result.stream.getReader();
      const start = await reader.read();
      expect(start.done).toBe(false);
      expect(start.value).toMatchObject({
        type: 'stream-start',
        warnings: expect.arrayContaining([
          expect.objectContaining({
            type: 'other',
            message: STREAMING_WARNING_MESSAGE,
          }),
        ]),
      });

      await reader.cancel();

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0];
      expect(typeof call.prompt).toBe('string');
    });

    it('should emit JSON once in object-json mode and return finish metadata', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: '{"a": 1' }],
            },
          };
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: ', "b": 2}' }],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'json-session-1',
            usage: {
              input_tokens: 6,
              output_tokens: 3,
            },
            total_cost_usd: 0.001,
            duration_ms: 1000,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Return JSON' }] }],
        temperature: 0.5, // This will trigger a warning
        responseFormat: { type: 'json' }, // Add responseFormat to trigger JSON mode
      });

      const chunks: any[] = [];
      const reader = result.stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      expect(chunks).toHaveLength(5);
      expect(chunks[0]).toMatchObject({
        type: 'stream-start',
        warnings: expect.arrayContaining([
          expect.objectContaining({
            type: 'unsupported-setting',
            setting: 'temperature',
          }),
        ]),
      });
      expect(chunks[1]).toMatchObject({
        type: 'text-start',
      });
      expect(chunks[2]).toMatchObject({
        type: 'text-delta',
        delta: '{\n  "a": 1,\n  "b": 2\n}',
      });
      expect(chunks[3]).toMatchObject({
        type: 'text-end',
      });
      expect(chunks[4]).toMatchObject({
        type: 'finish',
        finishReason: 'stop',
        usage: {
          inputTokens: 6,
          outputTokens: 3,
          totalTokens: 9,
        },
        providerMetadata: {
          'claude-code': {
            sessionId: 'json-session-1',
            costUsd: 0.001,
            durationMs: 1000,
          },
        },
      });

      // Warnings are now included in the stream-start event
      expect(chunks[0].warnings).toHaveLength(1);
      expect(chunks[0].warnings?.[0]).toMatchObject({
        type: 'unsupported-setting',
        setting: 'temperature',
      });
    });

    it('should handle malformed JSON in object-json streaming mode', async () => {
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'Here is the JSON: {"a": 1, "b": ' }],
            },
          };
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'invalid}' }],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'json-session-2',
            usage: {
              input_tokens: 8,
              output_tokens: 5,
            },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Return invalid JSON' }] }],
        responseFormat: { type: 'json' }, // Add responseFormat to trigger JSON mode
      });

      const chunks: any[] = [];
      const reader = result.stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      expect(chunks).toHaveLength(5);
      expect(chunks[0]).toMatchObject({
        type: 'stream-start',
        warnings: [],
      });
      expect(chunks[1]).toMatchObject({
        type: 'text-start',
      });
      // When JSON is malformed, extractJson returns the original text
      expect(chunks[2]).toMatchObject({
        type: 'text-delta',
        delta: 'Here is the JSON: {"a": 1, "b": invalid}',
      });
      expect(chunks[3]).toMatchObject({
        type: 'text-end',
      });
      expect(chunks[4]).toMatchObject({
        type: 'finish',
        finishReason: 'stop',
        usage: {
          inputTokens: 8,
          outputTokens: 5,
          totalTokens: 13,
        },
      });
    });

    it('emits tool streaming events for provider-executed tools', async () => {
      const toolUseId = 'toolu_123';
      const toolName = 'list_directory';
      const toolInput = { command: 'ls', args: ['-lah'] };
      const toolResultPayload = JSON.stringify([
        { name: 'README.md', size: 1024 },
        { name: 'package.json', size: 2048 },
      ]);

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: toolUseId,
                  name: toolName,
                  input: toolInput,
                },
              ],
            },
          };
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUseId,
                  name: toolName,
                  content: toolResultPayload,
                  is_error: false,
                },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'tool-session',
            usage: {
              input_tokens: 12,
              output_tokens: 3,
            },
            total_cost_usd: 0.002,
            duration_ms: 500,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'List files' }] }],
      });

      const events: LanguageModelV2StreamPart[] = [];
      const reader = stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const toolInputStart = events.find((event) => event.type === 'tool-input-start');
      const toolInputDelta = events.find((event) => event.type === 'tool-input-delta');
      const toolInputEnd = events.find((event) => event.type === 'tool-input-end');
      const toolCall = events.find((event) => event.type === 'tool-call');
      const toolResult = events.find((event) => event.type === 'tool-result');

      expect(toolInputStart).toMatchObject({
        type: 'tool-input-start',
        id: toolUseId,
        toolName,
        providerExecuted: true,
      });

      expect(toolInputDelta).toMatchObject({
        type: 'tool-input-delta',
        id: toolUseId,
        delta: JSON.stringify(toolInput),
      });

      expect(toolInputEnd).toMatchObject({
        type: 'tool-input-end',
        id: toolUseId,
      });

      expect(toolCall).toMatchObject({
        type: 'tool-call',
        toolCallId: toolUseId,
        toolName,
        input: JSON.stringify(toolInput),
        providerExecuted: true,
        providerMetadata: {
          'claude-code': {
            rawInput: JSON.stringify(toolInput),
          },
        },
      });

      expect(toolResult).toMatchObject({
        type: 'tool-result',
        toolCallId: toolUseId,
        toolName,
        result: JSON.parse(toolResultPayload),
        providerExecuted: true,
        isError: false,
        providerMetadata: {
          'claude-code': {
            rawResult: toolResultPayload,
          },
        },
      });
    });

  });

  describe('model configuration', () => {
    it('should store model ID correctly', () => {
      const sonnetModel = new ClaudeCodeLanguageModel({ id: 'sonnet' });
      expect(sonnetModel.modelId).toBe('sonnet');

      const opusModel = new ClaudeCodeLanguageModel({ id: 'opus' });
      expect(opusModel.modelId).toBe('opus');
      
      // Test custom model ID
      const customModel = new ClaudeCodeLanguageModel({ id: 'custom-model' });
      expect(customModel.modelId).toBe('custom-model');
    });
    
    it('should have correct provider name', () => {
      const model = new ClaudeCodeLanguageModel({ id: 'sonnet' });
      expect(model.provider).toBe('claude-code');
    });
    
    it('should have correct specification version', () => {
      const model = new ClaudeCodeLanguageModel({ id: 'sonnet' });
      expect(model.specificationVersion).toBe('v2');
    });
    
    it('should support object generation mode', () => {
      const model = new ClaudeCodeLanguageModel({ id: 'sonnet' });
      expect(model.defaultObjectGenerationMode).toBe('json');
    });
  });
});
