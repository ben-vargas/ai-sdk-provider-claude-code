import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// Mock the SDK module
vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  return {
    tool: vi.fn((_name, _description, _inputSchema, _handler, _extras) => ({
      name: _name,
      description: _description,
      inputSchema: _inputSchema,
      handler: _handler,
      annotations: _extras?.annotations,
    })),
    createSdkMcpServer: vi.fn((_options) => ({
      type: 'sdk' as const,
      name: _options.name,
      instance: { tools: _options.tools },
    })),
  };
});

import { tool as mockTool } from '@anthropic-ai/claude-agent-sdk';
import { createCustomMcpServer, createAiSdkMcpServer } from './mcp-helpers.js';
import type { ToolAnnotations, MinimalCallToolResult } from './mcp-helpers.js';

describe('createCustomMcpServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should forward annotations to tool() when provided', () => {
    const annotations: ToolAnnotations = {
      readOnlyHint: true,
      destructiveHint: false,
    };

    createCustomMcpServer({
      name: 'test-server',
      tools: {
        myTool: {
          description: 'A test tool',
          inputSchema: z.object({ query: z.string() }),
          handler: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
          annotations,
        },
      },
    });

    expect(vi.mocked(mockTool)).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(mockTool).mock.calls[0];
    expect(callArgs?.[0]).toBe('myTool');
    expect(callArgs?.[4]).toEqual({ annotations });
  });

  it('should pass undefined as 5th arg when annotations are not provided', () => {
    createCustomMcpServer({
      name: 'test-server',
      tools: {
        plainTool: {
          description: 'No annotations',
          inputSchema: z.object({ x: z.number() }),
          handler: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
        },
      },
    });

    expect(vi.mocked(mockTool)).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(mockTool).mock.calls[0];
    expect(callArgs?.[4]).toBeUndefined();
  });
});

describe('createAiSdkMcpServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  type MockedToolDef = {
    name: string;
    description: string;
    inputSchema: unknown;
    handler: (args: Record<string, unknown>, extra: unknown) => Promise<MinimalCallToolResult>;
  };

  function getToolDefs(config: unknown): MockedToolDef[] {
    return (config as { instance: { tools: MockedToolDef[] } }).instance.tools;
  }

  it('should produce a server config whose tools execute and return text content', async () => {
    const config = createAiSdkMcpServer('myTools', {
      greet: {
        description: 'Greet someone',
        inputSchema: z.object({ name: z.string() }),
        execute: async ({ name }: { name: string }) => `Hello, ${name}!`,
      },
    });

    expect(config).toMatchObject({ type: 'sdk', name: 'myTools' });
    const [greet] = getToolDefs(config);
    expect(greet?.name).toBe('greet');
    expect(greet?.description).toBe('Greet someone');
    // The Zod object's shape (a ZodRawShape) is passed to the SDK tool()
    expect(greet?.inputSchema).toHaveProperty('name');

    const result = await greet!.handler({ name: 'Ada' }, undefined);
    expect(result).toEqual({ content: [{ type: 'text', text: 'Hello, Ada!' }] });
  });

  it('should JSON.stringify non-string results', async () => {
    const config = createAiSdkMcpServer('myTools', {
      add: {
        inputSchema: z.object({ a: z.number(), b: z.number() }),
        execute: ({ a, b }: { a: number; b: number }) => ({ sum: a + b }),
      },
    });

    const [add] = getToolDefs(config);
    const result = await add!.handler({ a: 2, b: 3 }, undefined);
    expect(result).toEqual({ content: [{ type: 'text', text: '{"sum":5}' }] });
  });

  it('enforces object-level refinements before executing the tool', async () => {
    const execute = vi.fn(async () => 'ran');
    const config = createAiSdkMcpServer('myTools', {
      ordered: {
        // Object-level refinement lives on the object, not its `.shape`, so
        // the Agent SDK's shape-only validation would miss it.
        inputSchema: z
          .object({ a: z.number(), b: z.number() })
          .refine(({ a, b }) => a < b, { message: 'a must be less than b' }),
        execute,
      },
    });

    const [ordered] = getToolDefs(config);

    // Violates the refinement: must NOT run the tool, returns isError.
    const bad = await ordered!.handler({ a: 5, b: 2 }, undefined);
    expect(bad.isError).toBe(true);
    expect((bad.content[0] as { text: string }).text).toContain('Invalid arguments');
    expect(execute).not.toHaveBeenCalled();

    // Satisfies the refinement: runs with the parsed value.
    const good = await ordered!.handler({ a: 2, b: 5 }, undefined);
    expect(good.isError).toBeUndefined();
    expect(execute).toHaveBeenCalledWith({ a: 2, b: 5 }, expect.anything());
  });

  it('supports async Zod refinements via async parsing', async () => {
    const execute = vi.fn(async () => 'ran');
    const config = createAiSdkMcpServer('myTools', {
      asyncRefined: {
        inputSchema: z
          .object({ id: z.string() })
          .refine(async ({ id }) => id.startsWith('ok-'), { message: 'must start with ok-' }),
        execute,
      },
    });
    const [t] = getToolDefs(config);

    const bad = await t!.handler({ id: 'bad' }, undefined);
    expect(bad.isError).toBe(true);
    expect(execute).not.toHaveBeenCalled();

    const good = await t!.handler({ id: 'ok-1' }, undefined);
    expect(good.isError).toBeUndefined();
    expect(execute).toHaveBeenCalled();
  });

  it('drains an AsyncIterable result to its final value', async () => {
    const config = createAiSdkMcpServer('myTools', {
      streamy: {
        inputSchema: z.object({}),
        execute: async function* () {
          yield { partial: 1 };
          yield { partial: 2 };
          return { final: 'done' };
        } as never,
      },
    });
    const [streamy] = getToolDefs(config);
    const result = await streamy!.handler({}, undefined);
    // The last YIELDED value is used (generator return is not yielded), so
    // the final visible output is { partial: 2 } - serialized, not '{}'.
    expect(result).toEqual({ content: [{ type: 'text', text: '{"partial":2}' }] });
  });

  it('passes the parsed (transformed) value to execute', async () => {
    const execute = vi.fn(async () => 'ok');
    const config = createAiSdkMcpServer('myTools', {
      trimmed: {
        inputSchema: z.object({ name: z.string().transform((v) => v.trim()) }),
        execute,
      },
    });

    const [trimmed] = getToolDefs(config);
    await trimmed!.handler({ name: '  Ada  ' }, undefined);
    expect(execute).toHaveBeenCalledWith({ name: 'Ada' }, expect.anything());
  });

  it('should pass toolCallId and abortSignal from the MCP extra to execute', async () => {
    const execute = vi.fn(async () => 'ok');
    const config = createAiSdkMcpServer('myTools', {
      probe: {
        inputSchema: z.object({}),
        execute,
      },
    });

    const abortController = new AbortController();
    const [probe] = getToolDefs(config);
    await probe!.handler({}, { requestId: 42, signal: abortController.signal });

    expect(execute).toHaveBeenCalledWith(
      {},
      { toolCallId: '42', abortSignal: abortController.signal }
    );
  });

  it('should convert non-JSON-serializable results into isError results with a serialization message', async () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;

    const config = createAiSdkMcpServer('myTools', {
      loop: {
        inputSchema: z.object({}),
        execute: () => circular,
      },
    });

    const [loop] = getToolDefs(config);
    const result = await loop!.handler({}, undefined);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(
      /^Tool "loop" succeeded but its result could not be serialized to JSON: /
    );
    expect(result.content[0]?.text).toContain('circular');
  });

  it('should convert thrown errors into isError results', async () => {
    const config = createAiSdkMcpServer('myTools', {
      boom: {
        inputSchema: z.object({}),
        execute: () => {
          throw new Error('kaboom');
        },
      },
    });

    const [boom] = getToolDefs(config);
    const result = await boom!.handler({}, undefined);
    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'kaboom' }],
    });
  });

  it('should convert rejected promises into isError results', async () => {
    const config = createAiSdkMcpServer('myTools', {
      reject: {
        inputSchema: z.object({}),
        execute: async () => {
          throw new Error('async kaboom');
        },
      },
    });

    const [reject] = getToolDefs(config);
    const result = await reject!.handler({}, undefined);
    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'async kaboom' }],
    });
  });

  it('should throw at creation time when a tool lacks execute', () => {
    expect(() =>
      createAiSdkMcpServer('myTools', {
        noExec: {
          inputSchema: z.object({}),
        },
      })
    ).toThrow(/tool "noExec" has no execute function/);
  });

  it('should throw at creation time for jsonSchema()-based tools', () => {
    // Mimic the AI SDK's jsonSchema() helper output (Symbol marker + jsonSchema)
    const jsonSchemaLike = {
      [Symbol.for('vercel.ai.schema')]: true,
      jsonSchema: { type: 'object', properties: {} },
      validate: undefined,
    };

    expect(() =>
      createAiSdkMcpServer('myTools', {
        jsonTool: {
          inputSchema: jsonSchemaLike,
          execute: () => 'ok',
        },
      })
    ).toThrow(/Only Zod object schemas are supported/);
  });

  it('should throw at creation time when inputSchema is not a Zod object schema', () => {
    expect(() =>
      createAiSdkMcpServer('myTools', {
        plain: {
          inputSchema: { type: 'object', properties: {} },
          execute: () => 'ok',
        },
      })
    ).toThrow(/not a Zod object/);

    expect(() =>
      createAiSdkMcpServer('myTools', {
        notObject: {
          inputSchema: z.string(),
          execute: () => 'ok',
        },
      })
    ).toThrow(/not a Zod object/);
  });
});
