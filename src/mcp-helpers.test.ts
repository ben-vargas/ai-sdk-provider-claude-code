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

  it('accepts plain, refined, strict, and transform schemas at creation (no Zod-internal probing)', () => {
    // The bridge does not inspect Zod internals to reject schema modes — the
    // Agent SDK owns field-level validation and the bridge documents that
    // object-level constructs are not enforced. So none of these throw.
    expect(() =>
      createAiSdkMcpServer('myTools', {
        plain: { inputSchema: z.object({ a: z.number() }), execute: async () => 'ok' },
        strict: { inputSchema: z.object({ a: z.number() }).strict(), execute: async () => 'ok' },
        refined: {
          inputSchema: z.object({ a: z.number(), b: z.number() }).refine(({ a, b }) => a < b),
          execute: async () => 'ok',
        },
        transform: {
          inputSchema: z.object({ n: z.string().transform((v) => v.length) }),
          execute: async () => 'ok',
        },
      })
    ).not.toThrow();
  });

  it("does NOT re-parse args (object-level refinements are the caller's job in execute)", async () => {
    // The bridge passes the SDK-validated args straight to execute and does
    // NOT re-parse — re-parsing would re-run field transforms and reject
    // valid transform schemas. So an object-level refinement is NOT enforced
    // by the bridge; the tool runs and execute must do the cross-field check.
    const execute = vi.fn(async () => 'ran');
    const config = createAiSdkMcpServer('myTools', {
      ordered: {
        inputSchema: z
          .object({ a: z.number(), b: z.number() })
          .refine(({ a, b }) => a < b, { message: 'a must be less than b' }),
        execute,
      },
    });

    const [ordered] = getToolDefs(config);
    // Refinement-violating input is passed through (not enforced by the bridge).
    const res = await ordered!.handler({ a: 5, b: 2 }, undefined);
    expect(res.isError).toBeUndefined();
    expect(execute).toHaveBeenCalledWith({ a: 5, b: 2 }, expect.anything());
  });

  it('does not reject valid transform schemas whose output type differs from input', async () => {
    // z.string().transform(v => v.length) has input=string, output=number.
    // The SDK parses and passes the number to the handler; re-parsing would
    // reject it (expects string). The bridge must NOT re-parse.
    const execute = vi.fn(async () => 'ran');
    const config = createAiSdkMcpServer('myTools', {
      lengthy: {
        inputSchema: z.object({ n: z.string().transform((v) => v.length) }),
        execute,
      },
    });
    const [lengthy] = getToolDefs(config);
    // The SDK would pass the already-transformed value (a number); simulate that.
    const res = await lengthy!.handler({ n: 5 } as never, undefined);
    expect(res.isError).toBeUndefined();
    expect(execute).toHaveBeenCalledWith({ n: 5 }, expect.anything());
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

  it('does NOT re-transform args (the SDK already applied field transforms)', async () => {
    // The Agent SDK parses args against the shape before calling the handler,
    // so field transforms have already run (InferShape = each field's _output).
    // The bridge must pass those args straight through, NOT re-parse into a
    // second transform — { name: z.string().transform(v => v + '!') } given
    // model output "a!" (already transformed once) must reach execute as "a!",
    // not "a!!". In this unit harness no SDK runs, so execute sees args as-is.
    const execute = vi.fn(async () => 'ok');
    const config = createAiSdkMcpServer('myTools', {
      bang: {
        inputSchema: z.object({ name: z.string().transform((v) => `${v}!`) }),
        execute,
      },
    });

    const [bang] = getToolDefs(config);
    await bang!.handler({ name: 'already-once!' }, undefined);
    // Passed through unchanged — the transform is NOT applied a second time.
    expect(execute).toHaveBeenCalledWith({ name: 'already-once!' }, expect.anything());
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
