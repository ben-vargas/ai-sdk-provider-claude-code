import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeCodeLanguageModel } from './claude-code-language-model.js';
import type { LanguageModelV2StreamPart } from '@ai-sdk/provider';

// Extend stream part union locally to include provider-specific 'tool-error'
type ToolErrorPart = {
  type: 'tool-error';
  toolCallId: string;
  toolName: string;
  error: string;
  providerExecuted: true;
  providerMetadata?: Record<string, unknown>;
};
type ExtendedStreamPart = LanguageModelV2StreamPart | ToolErrorPart;

// Mock the SDK module with factory function
vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  return {
    query: vi.fn(),
    // Note: real SDK may not export AbortError at runtime; test mock provides it
    AbortError: class AbortError extends Error {
      constructor(message?: string) {
        super(message);
        this.name = 'AbortError';
      }
    },
  };
});

// Import the mocked module to get typed references
import { query as mockQuery, AbortError as MockAbortError } from '@anthropic-ai/claude-agent-sdk';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

const STREAMING_WARNING_MESSAGE =
  "Claude Agent SDK features (hooks/MCP/images) require streaming input. Set `streamingInput: 'always'` or provide `canUseTool` (auto streams only when canUseTool is set).";

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
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's2',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
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
          promptContentPromise = iterator
            .next()
            .then(({ value }) => (value as SDKUserMessage | undefined)?.message?.content);
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
        settings: {
          canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
          streamingInput: 'off',
        } as any,
      });
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's3',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
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
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's1',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
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

    it('should merge process.env with settings.env and allow undefined values', async () => {
      const originalMerge = process.env.C2_TEST_MERGE;
      const originalOverride = process.env.C2_TEST_OVERRIDE;
      try {
        process.env.C2_TEST_MERGE = 'from-process';
        process.env.C2_TEST_OVERRIDE = 'original';

        const modelWithEnv = new ClaudeCodeLanguageModel({
          id: 'sonnet',
          settings: {
            env: {
              CUSTOM_ENV: 'custom',
              C2_TEST_OVERRIDE: 'override',
              C2_TEST_UNDEF: undefined,
            },
          } as any,
        });

        const mockResponse = {
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'result',
              subtype: 'success',
              session_id: 's-env',
              usage: { input_tokens: 0, output_tokens: 0 },
            };
          },
        };
        vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

        await modelWithEnv.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        } as any);

        const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
        expect(call).toBeDefined();
        expect(call.options).toBeDefined();
        expect(call.options.env).toBeDefined();
        // Provided vars
        expect(call.options.env.CUSTOM_ENV).toBe('custom');
        expect(call.options.env.C2_TEST_OVERRIDE).toBe('override');
        // Merged from process.env
        expect(call.options.env.C2_TEST_MERGE).toBe('from-process');
        // Undefined values are preserved (key exists with undefined)
        expect('C2_TEST_UNDEF' in call.options.env).toBe(true);
        expect(call.options.env.C2_TEST_UNDEF).toBeUndefined();
      } finally {
        if (originalMerge === undefined) {
          delete process.env.C2_TEST_MERGE;
        } else {
          process.env.C2_TEST_MERGE = originalMerge;
        }
        if (originalOverride === undefined) {
          delete process.env.C2_TEST_OVERRIDE;
        } else {
          process.env.C2_TEST_OVERRIDE = originalOverride;
        }
      }
    });

    it('should omit env in SDK options when settings.env is undefined', async () => {
      const modelNoEnv = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {},
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's-noenv',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await modelNoEnv.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);

      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as any;
      expect(call).toBeDefined();
      expect(call.options).toBeDefined();
      expect(call.options.env).toBeUndefined();
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

    it('recovers from CLI truncation errors and returns buffered text', async () => {
      const repeatedTasks = Array.from({ length: 400 }, (_, i) => `task-${i}`).join('","');
      const partialResponse = `{"tasks": ["${repeatedTasks}`;
      const truncationPosition = partialResponse.length;
      const truncationError = new SyntaxError(
        `Unexpected end of JSON input at position ${truncationPosition} (line 1 column ${
          truncationPosition + 1
        })`
      );

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: partialResponse }],
            },
          };
          throw truncationError;
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Generate tasks' }] }],
        responseFormat: { type: 'json' },
      } as any);

      expect(result.finishReason).toBe('length');
      const hasTruncationWarning = result.warnings.some(
        (warning) =>
          'message' in warning &&
          typeof warning.message === 'string' &&
          warning.message.includes('output ended unexpectedly')
      );
      expect(hasTruncationWarning).toBe(true);
      expect(result.providerMetadata?.['claude-code']?.truncated).toBe(true);
      expect(result.content[0]).toEqual(
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('task-10'),
        })
      );
    });

    it('propagates JSON syntax errors without marking truncation', async () => {
      const partialResponse = '{"tasks": ["task-1"}';
      const parseError = new SyntaxError('Unexpected token } in JSON at position 18');

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: partialResponse }],
            },
          };
          throw parseError;
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await expect(
        model.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Generate tasks' }] }],
          responseFormat: { type: 'json' },
        } as any)
      ).rejects.toThrow(/Unexpected token \}/);
    });

    it('propagates short unexpected end errors without treating as truncation', async () => {
      const partialResponse = '{"tasks": "';
      const parseError = new SyntaxError('Unexpected end of JSON input');

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: partialResponse }],
            },
          };
          throw parseError;
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      await expect(
        model.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Generate tasks' }] }],
          responseFormat: { type: 'json' },
        } as any)
      ).rejects.toThrow(/Unexpected end of JSON input/);
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

    it('should emit JSON from structured_output in object-json mode and return finish metadata', async () => {
      // SDK 0.1.45+ returns structured_output directly in the result message
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'json-session-1',
            structured_output: { a: 1, b: 2 },
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
        responseFormat: { type: 'json', schema: { type: 'object' } }, // Add responseFormat with schema
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
        delta: '{"a":1,"b":2}',
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

      // Verify outputFormat was passed to SDK
      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as {
        options: { outputFormat?: { type: string; schema: unknown } };
      };
      expect(call.options?.outputFormat).toEqual({
        type: 'json_schema',
        schema: { type: 'object' },
      });
    });

    it('should handle structured output error from SDK', async () => {
      // SDK 0.1.45+ returns error_max_structured_output_retries when it can't produce valid output
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'error_max_structured_output_retries',
            session_id: 'json-error-session',
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
        responseFormat: { type: 'json', schema: { type: 'object' } },
      });

      const chunks: any[] = [];
      const reader = result.stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Should emit stream-start and then error
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toMatchObject({
        type: 'stream-start',
      });
      expect(chunks[1]).toMatchObject({
        type: 'error',
      });
      expect(chunks[1].error.message).toContain('structured output');
    });

    it('should warn and treat as plain text when JSON mode requested without schema', async () => {
      // When responseFormat.type === 'json' but no schema is provided,
      // Claude Code (like Anthropic) does not support JSON-without-schema.
      // We emit an unsupported-setting warning and treat as plain text.
      const plainText = 'Here is some text that happens to look like JSON: {"name": "test"}';
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: plainText }],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'json-no-schema-session',
            // No structured_output field - SDK didn't use outputFormat
            usage: {
              input_tokens: 10,
              output_tokens: 15,
            },
            total_cost_usd: 0.002,
            duration_ms: 200,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const result = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Return JSON' }] }],
        responseFormat: { type: 'json' }, // No schema provided
      });

      const chunks: any[] = [];
      const reader = result.stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Should emit: stream-start (with warning), text-start, text-delta, text-end, finish
      expect(chunks).toHaveLength(5);

      // Verify unsupported-setting warning is emitted
      expect(chunks[0]).toMatchObject({
        type: 'stream-start',
      });
      const streamStartWarnings = chunks[0].warnings;
      expect(streamStartWarnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'unsupported-setting',
            setting: 'responseFormat',
            details: expect.stringContaining('requires a schema'),
          }),
        ])
      );

      // Verify response is plain text (not parsed or modified)
      expect(chunks[1]).toMatchObject({
        type: 'text-start',
      });
      expect(chunks[2]).toMatchObject({
        type: 'text-delta',
        delta: plainText,
      });
      expect(chunks[3]).toMatchObject({
        type: 'text-end',
      });
      expect(chunks[4]).toMatchObject({
        type: 'finish',
        finishReason: 'stop',
        usage: {
          inputTokens: 10,
          outputTokens: 15,
          totalTokens: 25,
        },
      });

      // Verify outputFormat was NOT passed to SDK (no schema)
      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as {
        options: { outputFormat?: unknown };
      };
      expect(call.options?.outputFormat).toBeUndefined();
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

      const events: ExtendedStreamPart[] = [];
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

      expect(events.indexOf(toolInputDelta!)).toBeLessThan(events.indexOf(toolInputEnd!));

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

      expect(events.indexOf(toolInputEnd!)).toBeLessThan(events.indexOf(toolCall!));
      expect(events.indexOf(toolCall!)).toBeLessThan(events.indexOf(toolResult!));

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

    it('finalizes tool calls even when no tool result is emitted', async () => {
      const toolUseId = 'toolu_missing_result';
      const toolName = 'Read';

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
                  input: { file_path: '/tmp/example.txt' },
                },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'session-missing-result',
            usage: {
              input_tokens: 5,
              output_tokens: 0,
            },
            total_cost_usd: 0,
            duration_ms: 10,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Read file' }] }],
      });

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const toolInputStartIndex = events.findIndex((event) => event.type === 'tool-input-start');
      const toolInputEndIndex = events.findIndex((event) => event.type === 'tool-input-end');
      const toolCallIndex = events.findIndex((event) => event.type === 'tool-call');
      const toolResultIndex = events.findIndex((event) => event.type === 'tool-result');
      const finishIndex = events.findIndex((event) => event.type === 'finish');

      expect(toolInputStartIndex).toBeGreaterThan(-1);
      expect(toolInputEndIndex).toBeGreaterThan(toolInputStartIndex);
      expect(toolCallIndex).toBeGreaterThan(toolInputEndIndex);
      expect(toolResultIndex).toBe(-1);
      expect(finishIndex).toBeGreaterThan(toolCallIndex);

      const toolCallEvent = events[toolCallIndex];
      expect(toolCallEvent).toMatchObject({
        type: 'tool-call',
        toolCallId: toolUseId,
        toolName,
        input: JSON.stringify({ file_path: '/tmp/example.txt' }),
        providerExecuted: true,
      });
    });

    it('emits tool-error events for tool failures and orders after tool-call', async () => {
      const toolUseId = 'toolu_error';
      const toolName = 'Read';
      const errorMessage = 'File not found: /nonexistent.txt';

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
                  input: { file_path: '/nonexistent.txt' },
                },
              ],
            },
          };
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_error',
                  tool_use_id: toolUseId,
                  name: toolName,
                  error: errorMessage,
                },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'error-session',
            usage: { input_tokens: 10, output_tokens: 0 },
            total_cost_usd: 0.001,
            duration_ms: 100,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Read missing file' }] }],
      } as any);

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const toolError = events.find((e) => e.type === 'tool-error');
      const toolCall = events.find((e) => e.type === 'tool-call');

      expect(toolCall).toMatchObject({
        type: 'tool-call',
        toolCallId: toolUseId,
        toolName,
        providerExecuted: true,
      });

      expect(toolError).toMatchObject({
        type: 'tool-error',
        toolCallId: toolUseId,
        toolName,
        error: errorMessage,
        providerExecuted: true,
      });

      expect(events.indexOf(toolCall!)).toBeLessThan(events.indexOf(toolError!));
    });

    it('emits only one tool-call for multiple tool-result chunks', async () => {
      const toolUseId = 'toolu_chunked';
      const toolName = 'Bash';

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
                  input: { command: 'echo "test"' },
                },
              ],
            },
          };
          // First result chunk
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUseId,
                  name: toolName,
                  content: 'Chunk 1\n',
                  is_error: false,
                },
              ],
            },
          };
          // Second result chunk - same tool_use_id
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUseId,
                  name: toolName,
                  content: 'Chunk 2\n',
                  is_error: false,
                },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'chunked-session',
            usage: { input_tokens: 15, output_tokens: 5 },
            total_cost_usd: 0.002,
            duration_ms: 200,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Run command' }] }],
      } as any);

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const toolCalls = events.filter((e) => e.type === 'tool-call');
      const toolResults = events.filter((e) => e.type === 'tool-result');

      expect(toolCalls).toHaveLength(1);
      expect(toolResults).toHaveLength(2);
      expect(toolCalls[0]).toMatchObject({
        type: 'tool-call',
        toolCallId: toolUseId,
        toolName,
      });
    });

    it('synthesizes lifecycle for orphaned tool results (no prior tool_use)', async () => {
      const toolUseId = 'toolu_orphan';
      const toolName = 'Read';

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUseId,
                  name: toolName,
                  content: 'OK',
                  is_error: false,
                },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'orphan-session',
            usage: { input_tokens: 5, output_tokens: 1 },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Run' }] }],
      } as any);

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const inputStartIndex = events.findIndex((e) => e.type === 'tool-input-start');
      const inputEndIndex = events.findIndex((e) => e.type === 'tool-input-end');
      const callIndex = events.findIndex((e) => e.type === 'tool-call');
      const resultIndex = events.findIndex((e) => e.type === 'tool-result');

      expect(inputStartIndex).toBeGreaterThan(-1);
      expect(inputEndIndex).toBeGreaterThan(inputStartIndex);
      expect(callIndex).toBeGreaterThan(inputEndIndex);
      expect(resultIndex).toBeGreaterThan(callIndex);
    });

    // Note: Exhaustive size-limit error conditions are validated by unit-level logic; streaming emits metadata and/or errors.

    it('warns for large tool inputs but processes them', async () => {
      const toolUseId = 'toolu_large';
      const toolName = 'LargeTool';
      const largeInput = 'x'.repeat(200_000); // 200KB

      const consoleWarnSpy = vi.spyOn(console, 'warn');

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
                  input: { data: largeInput },
                },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'large-session',
            usage: { input_tokens: 10, output_tokens: 0 },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Large input test' }] }],
      } as any);

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      expect(consoleWarnSpy).toHaveBeenCalled();
      const toolCall = events.find((e) => e.type === 'tool-call');
      expect(toolCall).toBeDefined();
      consoleWarnSpy.mockRestore();
    });

    it('skips delta calculation for large inputs', async () => {
      const toolUseId = 'toolu_large_delta';
      const toolName = 'LargeDeltaTool';
      const largeInput = 'x'.repeat(50_000); // 50KB

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
                  input: { data: largeInput },
                },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'large-delta-session',
            usage: { input_tokens: 10, output_tokens: 0 },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Large delta test' }] }],
      } as any);

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const deltas = events.filter((e) => e.type === 'tool-input-delta');
      expect(deltas).toHaveLength(0);
      const toolCall = events.find((e) => e.type === 'tool-call');
      expect(toolCall).toBeDefined();
    });

    it('does not emit delta for non-prefix input updates', async () => {
      const toolUseId = 'toolu_nonprefix';
      const toolName = 'TestTool';

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          // First chunk
          yield {
            type: 'assistant',
            message: {
              content: [
                { type: 'tool_use', id: toolUseId, name: toolName, input: { arg: 'initial' } },
              ],
            },
          };
          // Second chunk - non-prefix replacement
          yield {
            type: 'assistant',
            message: {
              content: [
                { type: 'tool_use', id: toolUseId, name: toolName, input: { arg: 'replaced' } },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'nonprefix-session',
            usage: { input_tokens: 10, output_tokens: 2 },
            total_cost_usd: 0.001,
            duration_ms: 50,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
      } as any);

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const deltas = events.filter((e) => e.type === 'tool-input-delta');
      const toolCall = events.find((e) => e.type === 'tool-call') as any;

      expect(deltas).toHaveLength(1);
      expect((deltas[0] as any).delta).toBe(JSON.stringify({ arg: 'initial' }));
      expect(toolCall.input).toBe(JSON.stringify({ arg: 'replaced' }));
    });

    it('emits multiple tool-error chunks without duplicate tool-call', async () => {
      const toolUseId = 'toolu_multi_error';
      const toolName = 'Read';

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'tool_use', id: toolUseId, name: toolName, input: { file: 'x' } }],
            },
          };
          yield {
            type: 'user',
            message: {
              content: [
                { type: 'tool_error', tool_use_id: toolUseId, name: toolName, error: 'e1' },
              ],
            },
          };
          yield {
            type: 'user',
            message: {
              content: [
                { type: 'tool_error', tool_use_id: toolUseId, name: toolName, error: 'e2' },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'multierror-session',
            usage: { input_tokens: 1, output_tokens: 0 },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'run' }] }],
      } as any);

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const toolCalls = events.filter((e) => e.type === 'tool-call');
      const toolErrors = events.filter((e) => e.type === 'tool-error');
      expect(toolCalls).toHaveLength(1);
      expect(toolErrors).toHaveLength(2);
    });

    it('handles multiple concurrent tool calls', async () => {
      const id1 = 't1';
      const id2 = 't2';

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [
                { type: 'tool_use', id: id1, name: 'Read', input: { p: 'a' } },
                { type: 'tool_use', id: id2, name: 'Bash', input: { c: 'echo' } },
              ],
            },
          };
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: id1,
                  name: 'Read',
                  content: 'A',
                  is_error: false,
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
                  tool_use_id: id2,
                  name: 'Bash',
                  content: 'B',
                  is_error: false,
                },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'concurrent',
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'run' }] }],
      } as any);
      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const toolCalls = events.filter((e) => e.type === 'tool-call');
      const toolResults = events.filter((e) => e.type === 'tool-result');
      expect(toolCalls).toHaveLength(2);
      expect(toolResults).toHaveLength(2);
    });

    it('supports interleaved text and tool events', async () => {
      const toolUseId = 'tool_interleave';
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Intro ' }] } };
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'tool_use', id: toolUseId, name: 'Read', input: { p: '/f' } }],
            },
          };
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUseId,
                  name: 'Read',
                  content: 'OK',
                  is_error: false,
                },
              ],
            },
          };
          yield { type: 'assistant', message: { content: [{ type: 'text', text: ' Outro' }] } };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'inter',
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);
      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as any);
      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const firstTextIndex = events.findIndex((e) => e.type === 'text-delta');
      const toolCallIndex = events.findIndex((e) => e.type === 'tool-call');
      const lastTextIndex = events.findIndex(
        (e, i) => i > toolCallIndex && e.type === 'text-delta'
      );
      expect(firstTextIndex).toBeGreaterThan(-1);
      expect(toolCallIndex).toBeGreaterThan(firstTextIndex);
      expect(lastTextIndex).toBeGreaterThan(toolCallIndex);
    });

    it('passes outputFormat to SDK when responseFormat has schema', async () => {
      // SDK 0.1.45+ uses native structured outputs via outputFormat
      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'structured-output-session',
            structured_output: { name: 'test', value: 42 },
            usage: { input_tokens: 10, output_tokens: 20 },
            total_cost_usd: 0.002,
            duration_ms: 100,
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          value: { type: 'number' },
        },
        required: ['name', 'value'],
      };

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Generate JSON' }] }],
        responseFormat: { type: 'json', schema },
      } as any);

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      // Verify outputFormat was passed correctly to SDK
      const call = vi.mocked(mockQuery).mock.calls[0]?.[0] as {
        options: { outputFormat?: { type: string; schema: unknown } };
      };
      expect(call.options?.outputFormat).toEqual({
        type: 'json_schema',
        schema,
      });

      // Verify structured output was emitted as text
      const textDelta = events.find((e) => e.type === 'text-delta') as any;
      expect(textDelta).toBeDefined();
      expect(textDelta.delta).toBe('{"name":"test","value":42}');

      const finishEvent = events.find((e) => e.type === 'finish') as any;
      expect(finishEvent).toBeDefined();
      expect(finishEvent.providerMetadata?.['claude-code']?.sessionId).toBe(
        'structured-output-session'
      );
    });

    it('warns and skips messages with invalid structure', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn');

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          // Assistant message missing content
          yield {
            type: 'assistant',
            message: { role: 'assistant' },
          } as any;
          // User message missing content
          yield {
            type: 'user',
            message: { role: 'user' },
          } as any;
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'invalid-struct-session',
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'noop' }] }],
      } as any);

      const reader = stream.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    it('uses consistent fallback name for unknown tools', async () => {
      const toolUseId = 'toolu_unknown_name';

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: toolUseId,
                  // name omitted/unknown
                  input: { x: 1 },
                } as any,
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
                  content: 'ok',
                },
              ],
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's-unknown',
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'run' }] }],
      } as any);

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const toolCall = events.find((e) => e.type === 'tool-call');
      expect(toolCall).toMatchObject({
        type: 'tool-call',
        toolName: 'unknown-tool',
      });
    });

    it('emits finish event with truncated metadata when CLI truncates JSON stream', async () => {
      const repeatedItems = Array.from({ length: 300 }, (_, i) => `item-${i}`).join('","');
      const partialJson = `{"result": {"items": ["${repeatedItems}`;
      const truncationPosition = partialJson.length;
      const truncationError = new SyntaxError(
        `Unterminated string in JSON at position ${truncationPosition}`
      );

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: partialJson }],
            },
          };
          throw truncationError;
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Return JSON' }] }],
        responseFormat: { type: 'json' },
      } as any);

      const events: LanguageModelV2StreamPart[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      expect(events.some((event) => event.type === 'error')).toBe(false);

      const finishEvent = events.find((event) => event.type === 'finish');
      expect(finishEvent).toBeDefined();
      expect(
        finishEvent && 'finishReason' in finishEvent ? finishEvent.finishReason : undefined
      ).toBe('length');

      const finishMetadata =
        finishEvent && 'providerMetadata' in finishEvent ? finishEvent.providerMetadata : undefined;
      const claudeMetadata =
        finishMetadata && 'claude-code' in finishMetadata
          ? (finishMetadata['claude-code'] as Record<string, unknown>)
          : undefined;
      expect(claudeMetadata?.truncated).toBe(true);

      const serializedWarnings = Array.isArray(claudeMetadata?.warnings)
        ? (claudeMetadata?.warnings as Array<Record<string, unknown>>)
        : [];
      expect(
        serializedWarnings.some(
          (warning) =>
            typeof warning.message === 'string' &&
            warning.message.includes('output ended unexpectedly')
        )
      ).toBe(true);

      const textDelta = events.find((event) => event.type === 'text-delta');
      expect(textDelta && 'delta' in textDelta ? textDelta.delta : '').toContain('items');

      const textEnd = events.find((event) => event.type === 'text-end');
      expect(textEnd).toBeDefined();
    });

    it('emits an error event for malformed JSON without treating it as truncation', async () => {
      const partialJson = '{"result": {"items": [1, 2}}';
      const parseError = new SyntaxError('Unexpected token } in JSON at position 24');

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: partialJson }],
            },
          };
          throw parseError;
        },
      };

      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Return JSON' }] }],
        responseFormat: { type: 'json' },
      } as any);

      const events: ExtendedStreamPart[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(value);
      }

      const errorEvent = events.find((event) => event.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(
        errorEvent && 'error' in errorEvent && errorEvent.error
          ? (errorEvent.error as Error).message
          : ''
      ).toMatch(/Unexpected token \}/);
      expect(events.some((event) => event.type === 'finish')).toBe(false);
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
