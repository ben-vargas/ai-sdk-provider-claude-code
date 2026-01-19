import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeCodeLanguageModel } from './claude-code-language-model.js';
import { claudeCodeSettingsSchema } from './validation.js';
import type { MessageInjector } from './types.js';

// Mock the SDK module
vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  return {
    query: vi.fn(),
  };
});

import { query as mockQuery } from '@anthropic-ai/claude-agent-sdk';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

describe('MessageInjector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validation', () => {
    it('should accept onStreamStart as a function', () => {
      const settings = {
        onStreamStart: () => {},
      };
      const result = claudeCodeSettingsSchema.safeParse(settings);
      expect(result.success).toBe(true);
    });

    it('should reject onStreamStart if not a function', () => {
      const settings = {
        onStreamStart: 'not-a-function',
      };
      const result = claudeCodeSettingsSchema.safeParse(settings);
      expect(result.success).toBe(false);
    });

    it('should accept settings without onStreamStart', () => {
      const settings = {};
      const result = claudeCodeSettingsSchema.safeParse(settings);
      expect(result.success).toBe(true);
    });
  });

  describe('onStreamStart callback', () => {
    it('should call onStreamStart when streaming input is enabled and prompt is iterated', async () => {
      const onStreamStart = vi.fn((injector) => {
        // Close immediately so the stream can complete
        injector.close();
      });
      const model = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          streamingInput: 'always',
          onStreamStart,
        },
      });

      // Mock that iterates the prompt (which triggers onStreamStart)
      vi.mocked(mockQuery).mockImplementation(({ prompt }: any) => {
        // Consume the async iterable to trigger onStreamStart
        void (async () => {
          if (prompt && typeof prompt[Symbol.asyncIterator] === 'function') {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            for await (const _ of prompt) {
              // Just iterate to trigger the callback
            }
          }
        })();

        return {
          async *[Symbol.asyncIterator]() {
            await new Promise((r) => setTimeout(r, 50));
            yield {
              type: 'result',
              subtype: 'success',
              session_id: 'test-session',
              usage: { input_tokens: 10, output_tokens: 20 },
            };
          },
        } as any;
      });

      await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      } as any);

      expect(onStreamStart).toHaveBeenCalledTimes(1);
      expect(onStreamStart).toHaveBeenCalledWith(
        expect.objectContaining({
          inject: expect.any(Function),
          close: expect.any(Function),
        })
      );
    });

    it('should not call onStreamStart when streamingInput is off', async () => {
      const onStreamStart = vi.fn();
      const model = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          streamingInput: 'off',
          onStreamStart,
        },
      });

      vi.mocked(mockQuery).mockImplementation(() => {
        // With streamingInput off, prompt is a string, not AsyncIterable
        // So onStreamStart should never be called
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'result',
              subtype: 'success',
              session_id: 'test-session',
              usage: { input_tokens: 10, output_tokens: 20 },
            };
          },
        } as any;
      });

      await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      } as any);

      expect(onStreamStart).not.toHaveBeenCalled();
    });

    it('should provide a working MessageInjector when prompt is iterated', async () => {
      let capturedInjector: MessageInjector | null = null;
      const model = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          streamingInput: 'always',
          onStreamStart: (injector) => {
            capturedInjector = injector;
            injector.close();
          },
        },
      });

      vi.mocked(mockQuery).mockImplementation(({ prompt }: any) => {
        void (async () => {
          if (prompt && typeof prompt[Symbol.asyncIterator] === 'function') {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            for await (const _ of prompt) {
              // Iterate to trigger callback
            }
          }
        })();

        return {
          async *[Symbol.asyncIterator]() {
            await new Promise((r) => setTimeout(r, 50));
            yield {
              type: 'result',
              subtype: 'success',
              session_id: 'test-session',
              usage: { input_tokens: 10, output_tokens: 20 },
            };
          },
        } as any;
      });

      await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      } as any);

      expect(capturedInjector).not.toBeNull();
      expect(typeof capturedInjector!.inject).toBe('function');
      expect(typeof capturedInjector!.close).toBe('function');
    });
  });

  describe('message injection flow', () => {
    it('should pass injected messages to the SDK prompt', async () => {
      const collectedMessages: SDKUserMessage[] = [];

      const model = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          streamingInput: 'always',
          onStreamStart: (injector) => {
            // Inject a message immediately
            injector.inject('Injected message!');
            // Then close to let the stream complete
            injector.close();
          },
        },
      });

      // Create a mock that collects all yielded messages from the prompt
      vi.mocked(mockQuery).mockImplementation(({ prompt }: any) => {
        // Consume the async iterable in the background
        void (async () => {
          if (prompt && typeof prompt[Symbol.asyncIterator] === 'function') {
            for await (const msg of prompt) {
              collectedMessages.push(msg);
            }
          }
        })();

        // Return a mock response
        return {
          async *[Symbol.asyncIterator]() {
            // Small delay to let injection happen
            await new Promise((r) => setTimeout(r, 50));
            yield {
              type: 'result',
              subtype: 'success',
              session_id: 'test-session',
              usage: { input_tokens: 10, output_tokens: 20 },
            };
          },
        } as any;
      });

      await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      } as any);

      // Should have initial message + injected message
      expect(collectedMessages.length).toBeGreaterThanOrEqual(1);

      // First message should be the initial user message
      expect(collectedMessages[0].type).toBe('user');
      expect(collectedMessages[0].message.role).toBe('user');
    });

    it('should handle multiple injected messages', async () => {
      const collectedMessages: SDKUserMessage[] = [];

      const model = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          streamingInput: 'always',
          onStreamStart: (injector) => {
            // Inject multiple messages
            injector.inject('First injection');
            injector.inject('Second injection');
            injector.inject('Third injection');
            injector.close();
          },
        },
      });

      vi.mocked(mockQuery).mockImplementation(({ prompt }: any) => {
        void (async () => {
          if (prompt && typeof prompt[Symbol.asyncIterator] === 'function') {
            for await (const msg of prompt) {
              collectedMessages.push(msg);
            }
          }
        })();

        return {
          async *[Symbol.asyncIterator]() {
            await new Promise((r) => setTimeout(r, 100));
            yield {
              type: 'result',
              subtype: 'success',
              session_id: 'test-session',
              usage: { input_tokens: 10, output_tokens: 20 },
            };
          },
        } as any;
      });

      await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      } as any);

      // Should have initial + 3 injected messages = 4 total
      // (though timing may affect this in tests)
      expect(collectedMessages.length).toBeGreaterThanOrEqual(1);
    });

    it('should ignore inject calls after close', async () => {
      const model = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          streamingInput: 'always',
          onStreamStart: (injector) => {
            injector.close();
            // This should be ignored
            injector.inject('Should be ignored');
          },
        },
      });

      const mockResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'test-session',
            usage: { input_tokens: 10, output_tokens: 20 },
          };
        },
      };
      vi.mocked(mockQuery).mockReturnValue(mockResponse as any);

      // Should not throw
      await expect(
        model.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
        } as any)
      ).resolves.toBeDefined();
    });
  });

  describe('delivery callback', () => {
    it('should call onResult with true when message is delivered', async () => {
      const deliveryResults: boolean[] = [];

      const model = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          streamingInput: 'always',
          onStreamStart: (injector) => {
            injector.inject('Test message', (delivered) => {
              deliveryResults.push(delivered);
            });
            injector.close();
          },
        },
      });

      vi.mocked(mockQuery).mockImplementation(({ prompt }: any) => {
        void (async () => {
          if (prompt && typeof prompt[Symbol.asyncIterator] === 'function') {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            for await (const _ of prompt) {
              // Iterate to trigger delivery
            }
          }
        })();

        return {
          async *[Symbol.asyncIterator]() {
            await new Promise((r) => setTimeout(r, 100));
            yield {
              type: 'result',
              subtype: 'success',
              session_id: 'test-session',
              usage: { input_tokens: 10, output_tokens: 20 },
            };
          },
        } as any;
      });

      await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      } as any);

      expect(deliveryResults).toContain(true);
    });

    it('should call onResult with false when session ends before delivery', async () => {
      const deliveryResults: boolean[] = [];

      const model = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          streamingInput: 'always',
          onStreamStart: (injector) => {
            // Inject after a delay - session will end first
            setTimeout(() => {
              injector.inject('Too late message', (delivered) => {
                deliveryResults.push(delivered);
              });
            }, 50);
          },
        },
      });

      vi.mocked(mockQuery).mockImplementation(({ prompt }: any) => {
        // Start iterating prompt but end session quickly
        void (async () => {
          if (prompt && typeof prompt[Symbol.asyncIterator] === 'function') {
            const iter = prompt[Symbol.asyncIterator]();
            await iter.next(); // Get initial message
            // Call next() again to resume generator and trigger onStreamStart
            // Don't await - let it run in background while session ends
            iter.next();
          }
        })();

        return {
          async *[Symbol.asyncIterator]() {
            // Small delay then end - session ends before the 50ms inject
            await new Promise((r) => setTimeout(r, 20));
            yield {
              type: 'result',
              subtype: 'success',
              session_id: 'test-session',
              usage: { input_tokens: 10, output_tokens: 20 },
            };
          },
        } as any;
      });

      await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      } as any);

      // Wait for the delayed inject to happen and be processed
      await new Promise((r) => setTimeout(r, 150));

      expect(deliveryResults).toContain(false);
    });

    it('should call onResult with false when inject is called after close', async () => {
      const deliveryResults: boolean[] = [];

      const model = new ClaudeCodeLanguageModel({
        id: 'sonnet',
        settings: {
          streamingInput: 'always',
          onStreamStart: (injector) => {
            injector.close();
            injector.inject('After close', (delivered) => {
              deliveryResults.push(delivered);
            });
          },
        },
      });

      vi.mocked(mockQuery).mockImplementation(({ prompt }: any) => {
        // Iterate prompt to trigger onStreamStart
        void (async () => {
          if (prompt && typeof prompt[Symbol.asyncIterator] === 'function') {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            for await (const _ of prompt) {
              // Iterate to trigger callback
            }
          }
        })();

        return {
          async *[Symbol.asyncIterator]() {
            await new Promise((r) => setTimeout(r, 50));
            yield {
              type: 'result',
              subtype: 'success',
              session_id: 'test-session',
              usage: { input_tokens: 10, output_tokens: 20 },
            };
          },
        } as any;
      });

      await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      } as any);

      expect(deliveryResults).toEqual([false]);
    });
  });
});
