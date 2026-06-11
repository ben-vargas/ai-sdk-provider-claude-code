import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type {
  McpSdkServerConfigWithInstance,
  SdkMcpToolDefinition,
} from '@anthropic-ai/claude-agent-sdk';
import { type ZodRawShape, type ZodObject } from 'zod';

/**
 * Optional annotations for content items, per MCP specification.
 * Validated against MCP SDK schema version 2025-06-18.
 */
type ContentAnnotations = {
  /** Intended audience(s) for this content */
  audience?: ('user' | 'assistant')[];
  /** Priority hint (0 = least important, 1 = most important) */
  priority?: number;
  /** ISO 8601 timestamp of last modification */
  lastModified?: string;
};

/**
 * MCP tool annotations for hinting tool behavior to the model.
 * Derived from the SDK's SdkMcpToolDefinition type to stay in sync
 * with the upstream MCP ToolAnnotations definition.
 */
export type ToolAnnotations = NonNullable<SdkMcpToolDefinition['annotations']>;

/**
 * Convenience helper to create an SDK MCP server from a simple tool map.
 * Each tool provides a description, a Zod object schema, and a handler.
 *
 * Type definition validated against MCP SDK specification version 2025-06-18.
 * See: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
 */
export type MinimalCallToolResult = {
  content: Array<
    | {
        /** Text content */
        type: 'text';
        /** The text content (plain text or structured format like JSON) */
        text: string;
        annotations?: ContentAnnotations;
        _meta?: Record<string, unknown>;
        [key: string]: unknown;
      }
    | {
        /** Image content (base64-encoded) */
        type: 'image';
        /** Base64-encoded image data */
        data: string;
        /** MIME type of the image (e.g., image/png, image/jpeg) */
        mimeType: string;
        annotations?: ContentAnnotations;
        _meta?: Record<string, unknown>;
        [key: string]: unknown;
      }
    | {
        /** Audio content (base64-encoded) */
        type: 'audio';
        /** Base64-encoded audio data */
        data: string;
        /** MIME type of the audio (e.g., audio/wav, audio/mp3) */
        mimeType: string;
        annotations?: ContentAnnotations;
        _meta?: Record<string, unknown>;
        [key: string]: unknown;
      }
    | {
        /** Embedded resource with full content (text or blob) */
        type: 'resource';
        /** Resource contents - either text or blob variant */
        resource: { uri: string; _meta?: Record<string, unknown>; [key: string]: unknown } & (
          | { text: string; mimeType?: string }
          | { blob: string; mimeType: string }
        );
        annotations?: ContentAnnotations;
        _meta?: Record<string, unknown>;
        [key: string]: unknown;
      }
    | {
        /** Resource link (reference only - no embedded content) */
        type: 'resource_link';
        /** URI of the resource */
        uri: string;
        /** Human-readable name (required per MCP spec) */
        name: string;
        /** Optional description of what this resource represents */
        description?: string;
        /** MIME type of the resource, if known */
        mimeType?: string;
        annotations?: ContentAnnotations;
        _meta?: Record<string, unknown>;
        [key: string]: unknown;
      }
  >;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
};

/**
 * Builds an `isError: true` MCP tool result carrying a single text content
 * item. Centralizes the {@link MinimalCallToolResult} error shape so the
 * handler's several error paths (invalid arguments, serialization failure,
 * thrown/rejected execute) all produce an identical structure.
 */
function buildIsErrorResult(text: string): MinimalCallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text }],
  };
}

/**
 * Converts a value returned by an AI SDK tool's `execute` into MCP text.
 *
 * Owns the two accreted concerns of result handling:
 * 1. AsyncIterable draining: `execute` may return an async iterator that
 *    yields partial outputs and a final value; the SDK uses the last *yielded*
 *    value (a generator's `return` is not yielded). Drain it to that final
 *    value instead of stringifying the iterator object to `{}`.
 * 2. Serialization: strings pass through unchanged; everything else is
 *    `JSON.stringify`'d. `JSON.stringify(undefined)` returns `undefined`
 *    (not a string), so the literal `'undefined'` fallback is preserved.
 *    A serialization failure (e.g. circular reference) yields a descriptive
 *    `isError` result rather than throwing.
 *
 * The drain runs OUTSIDE the serialization `try/catch` on purpose: a throw
 * while draining must propagate to the handler's outer `catch` (becoming a
 * generic `isError` from the error message), not be misreported as a
 * serialization failure.
 *
 * @returns `{ text }` on success, or `{ isError }` carrying a ready-made
 *   serialization-failure result.
 */
async function normalizeToolResultToText(
  toolName: string,
  result: unknown
): Promise<{ text: string } | { isError: MinimalCallToolResult }> {
  // Drain an AsyncIterable to its final yielded value (outside the
  // serialization try/catch — see doc comment).
  if (
    result != null &&
    typeof (result as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
  ) {
    let last: unknown;
    for await (const chunk of result as AsyncIterable<unknown>) {
      last = chunk;
    }
    result = last;
  }

  if (typeof result === 'string') {
    return { text: result };
  }
  try {
    return { text: JSON.stringify(result) ?? 'undefined' };
  } catch (serializationError) {
    const reason =
      serializationError instanceof Error ? serializationError.message : String(serializationError);
    return {
      isError: buildIsErrorResult(
        `Tool "${toolName}" succeeded but its result could not be serialized to JSON: ${reason}`
      ),
    };
  }
}

export function createCustomMcpServer<
  Tools extends Record<
    string,
    {
      description: string;
      inputSchema: ZodObject<ZodRawShape>;
      handler: (args: Record<string, unknown>, extra: unknown) => Promise<MinimalCallToolResult>;
      annotations?: ToolAnnotations;
    }
  >,
>(config: { name: string; version?: string; tools: Tools }): McpSdkServerConfigWithInstance {
  const defs = Object.entries(config.tools).map(([name, def]) =>
    tool(
      name,
      def.description,
      def.inputSchema.shape as ZodRawShape,
      (args: Record<string, unknown>, extra: unknown) => def.handler(args, extra),
      def.annotations ? { annotations: def.annotations } : undefined
    )
  );
  return createSdkMcpServer({ name: config.name, version: config.version, tools: defs });
}

/**
 * Minimal per-call options passed to an AI SDK tool's `execute` function
 * when it is invoked through {@link createAiSdkMcpServer}.
 *
 * Note that the AI SDK's full `ToolCallOptions` (e.g. `messages`,
 * `experimental_context`) is not available here: the tool runs inside the
 * Claude Code CLI's MCP transport, outside the AI SDK call loop.
 */
export type AiSdkToolExecuteOptions = {
  /**
   * Identifier of the MCP request that triggered this call, when available.
   *
   * Note: this is the MCP JSON-RPC request id (often a small integer like
   * `'42'`), not the model's `toolu_...` tool_use id, so it will not match
   * the `toolCallId` on the AI SDK's `tool-call`/`tool-result` stream parts.
   */
  toolCallId?: string;
  /** Abort signal for the MCP request, when available. */
  abortSignal?: AbortSignal;
};

/**
 * Structural shape of an AI SDK tool (what the `ai` package's `tool()` helper
 * returns) as accepted by {@link createAiSdkMcpServer}. Deliberately
 * structurally typed so this package does not depend on the `ai` package.
 *
 * Constraints:
 * - `inputSchema` must be a Zod object schema (`z.object({...})`, Zod v3 or
 *   v4) — the same schema you would pass to the `ai` package's `tool()`
 *   helper. Schemas created with the AI SDK's `jsonSchema()` helper are not
 *   supported because the Agent SDK's `tool()` requires a Zod shape.
 * - `execute` is required: only tools that execute locally can be bridged.
 */
export type AiSdkLikeTool = {
  description?: string;
  /** A Zod object schema (`z.object({...})`), Zod v3 or v4. */
  inputSchema: unknown;
  /**
   * Tool implementation. Receives the validated input and a minimal options
   * object ({@link AiSdkToolExecuteOptions}).
   *
   * Optional in the type only to stay assignment-compatible with the AI
   * SDK's `Tool` type — {@link createAiSdkMcpServer} throws at creation time
   * if it is missing.
   */
  execute?(input: never, options?: AiSdkToolExecuteOptions): PromiseLike<unknown> | unknown;
};

/** Symbol marker set by the AI SDK's `jsonSchema()`/`asSchema()` helpers. */
const AI_SDK_SCHEMA_SYMBOL = Symbol.for('vercel.ai.schema');

function isAiSdkJsonSchema(schema: unknown): boolean {
  return typeof schema === 'object' && schema !== null && AI_SDK_SCHEMA_SYMBOL in schema;
}

function isZodObjectSchema(schema: unknown): schema is ZodObject<ZodRawShape> {
  if (typeof schema !== 'object' || schema === null) {
    return false;
  }
  const candidate = schema as {
    _zod?: { def?: { type?: string } };
    _def?: { typeName?: string };
    shape?: unknown;
  };
  // Zod v4 instances carry `_zod`; Zod v3 instances carry `_def`.
  if (!('_zod' in candidate) && !('_def' in candidate)) {
    return false;
  }
  const typeTag = candidate._zod?.def?.type ?? candidate._def?.typeName;
  if (typeTag !== 'object' && typeTag !== 'ZodObject') {
    return false;
  }
  return typeof candidate.shape === 'object' && candidate.shape !== null;
}

/**
 * Detects a Zod object whose unknown-key handling is NON-default
 * (`.strict()`, `.passthrough()`, or `.catchall()`). The Agent SDK's
 * `tool(name, desc, shape, ...)` takes only the schema's `.shape` and
 * re-wraps it as a DEFAULT (stripping) object, which strips unknown keys
 * before our handler runs — so these modes cannot round-trip and a `.strict()`
 * schema would NOT reject extra keys as declared. In Zod v4 these modes set a
 * `catchall` on the object def; a plain object has none. Detection is
 * conservative: if the internal shape is ever unrecognizable (e.g. a future
 * Zod layout), it returns false rather than throwing on a valid plain schema.
 */
function hasNonDefaultUnknownKeyMode(schema: ZodObject<ZodRawShape>): boolean {
  const v4 = (schema as { _zod?: { def?: { catchall?: unknown } } })._zod?.def;
  if (v4) {
    // Zod v4: a plain object has NO `catchall`; .strict()/.passthrough()/
    // .catchall() set one. (Do NOT use this for v3 — v3 plain objects always
    // carry a ZodNever catchall, which would false-reject them.)
    return v4.catchall !== undefined;
  }
  const v3 = (schema as { _def?: { unknownKeys?: unknown } })._def;
  if (v3 && typeof v3.unknownKeys === 'string') {
    // Zod v3: the mode lives in `unknownKeys` ('strip' is the default).
    return v3.unknownKeys !== 'strip';
  }
  // Unrecognized layout: do NOT throw on a possibly-valid plain schema.
  return false;
}

/**
 * Bridges AI SDK tool definitions (the `ai` package's `tool()` helper) into
 * an in-process SDK MCP server that the Claude Code CLI can execute.
 *
 * Why this helper exists: the Claude Code CLI executes its own tools, so AI
 * SDK tools passed to `generateText`/`streamText` via the `tools` option
 * cannot be auto-bridged by the provider — at the `LanguageModelV3` layer the
 * provider only receives tool *declarations* (name, description, JSON
 * schema); the `execute` functions live in the `ai` package layer and never
 * reach providers. This helper is the explicit alternative: pass your tools
 * here and wire the result into the `mcpServers` setting.
 *
 * Validation: object-level `.refine()`/`.superRefine()` ARE enforced (the
 * handler re-parses with the full schema via `safeParseAsync`). Unknown-key
 * MODES are NOT supported — `.strict()`/`.passthrough()`/`.catchall()` throw at
 * creation time, because the Agent SDK's `tool()` takes only the schema shape
 * and validates against a default (stripping) object, so those modes cannot
 * round-trip. Declare tools with a plain `z.object({...})`.
 *
 * Each tool's `execute` is called with the validated input and a minimal
 * options object ({@link AiSdkToolExecuteOptions}). String results pass
 * through as MCP text content; all other results are `JSON.stringify`'d.
 * Errors thrown (or rejections) become `isError: true` tool results instead
 * of crashing the CLI session. Results that cannot be serialized to JSON
 * (e.g. circular objects) also become `isError: true` results with a
 * serialization message, even though the tool itself succeeded.
 *
 * Tool results surface to the AI SDK as provider-executed dynamic tool parts
 * (`tool-call`/`tool-result` with `mcp__<serverName>__<toolName>` names), not
 * as executions of your local `tools` option.
 *
 * @param name - MCP server name. Tools are exposed to the CLI as
 *   `mcp__<name>__<toolName>`.
 * @param tools - Map of tool name to AI SDK tool. Each tool must have an
 *   `execute` function and a Zod object schema as its `inputSchema`
 *   (`jsonSchema()`-based tools are rejected).
 * @returns An SDK MCP server config for the `mcpServers` setting.
 * @throws If a tool lacks an `execute` function or its `inputSchema` is not
 *   a Zod object schema.
 *
 * @example
 * ```typescript
 * import { generateText, tool } from 'ai';
 * import { z } from 'zod';
 * import { claudeCode, createAiSdkMcpServer } from 'ai-sdk-provider-claude-code';
 *
 * const tools = {
 *   add: tool({
 *     description: 'Add two numbers',
 *     inputSchema: z.object({ a: z.number(), b: z.number() }),
 *     execute: async ({ a, b }) => ({ sum: a + b }),
 *   }),
 * };
 *
 * const { text } = await generateText({
 *   model: claudeCode('sonnet', {
 *     mcpServers: { myTools: createAiSdkMcpServer('myTools', tools) },
 *     // Tools are named mcp__<serverName>__<toolName>
 *     allowedTools: ['mcp__myTools__add'],
 *   }),
 *   prompt: 'What is 2 + 3? Use the add tool.',
 * });
 * ```
 */
export function createAiSdkMcpServer(
  name: string,
  tools: Record<string, AiSdkLikeTool>
): McpSdkServerConfigWithInstance {
  const defs = Object.entries(tools).map(([toolName, def]) => {
    const execute = def.execute;
    if (typeof execute !== 'function') {
      throw new Error(
        `createAiSdkMcpServer: tool "${toolName}" has no execute function. ` +
          'Only tools that execute locally can be bridged to the Claude Code CLI.'
      );
    }
    if (isAiSdkJsonSchema(def.inputSchema)) {
      throw new Error(
        `createAiSdkMcpServer: tool "${toolName}" uses a JSON Schema-based inputSchema ` +
          "(e.g. the AI SDK's jsonSchema() helper). Only Zod object schemas are supported " +
          "because the Agent SDK's tool() requires a Zod shape. " +
          'Define inputSchema with z.object({...}) instead.'
      );
    }
    if (!isZodObjectSchema(def.inputSchema)) {
      throw new Error(
        `createAiSdkMcpServer: tool "${toolName}" has an inputSchema that is not a Zod object ` +
          'schema. Pass the same z.object({...}) schema you would give to the AI SDK tool() helper.'
      );
    }
    // Narrowed schema (captured so the async handler closure keeps the type).
    const zodSchema: ZodObject<ZodRawShape> = def.inputSchema;
    if (hasNonDefaultUnknownKeyMode(zodSchema)) {
      throw new Error(
        `createAiSdkMcpServer: tool "${toolName}" uses a non-default unknown-key mode ` +
          "(.strict() / .passthrough() / .catchall()). The Agent SDK's tool() validates " +
          'against a default object derived from the schema shape and STRIPS unknown keys ' +
          'before the handler runs, so these modes cannot be enforced through the bridge. ' +
          'Declare the tool with a plain z.object({...}) and handle extra/unknown keys inside ' +
          'execute() (object-level .refine()/.superRefine() ARE enforced).'
      );
    }
    return tool(
      toolName,
      def.description ?? '',
      zodSchema.shape as ZodRawShape,
      async (args: Record<string, unknown>, extra: unknown): Promise<MinimalCallToolResult> => {
        try {
          // The Agent SDK's tool() validates against the object's `.shape`
          // (per-field), which DROPS object-level refinements
          // (z.object({...}).refine(...) / .superRefine(...)). Re-parse with
          // the full schema so those run before the tool executes, and pass
          // the parsed (and possibly transformed) value to execute(). Use the
          // ASYNC parser: AI SDK tools may use async refinements/transforms,
          // which throw "Encountered Promise during synchronous parse" under
          // the sync parser.
          const parsed = await zodSchema.safeParseAsync(args);
          if (!parsed.success) {
            return buildIsErrorResult(
              `Invalid arguments for tool "${toolName}": ${parsed.error.message}`
            );
          }
          const extraInfo = (extra ?? {}) as { signal?: AbortSignal; requestId?: string | number };
          // Preserve `this === def` so tools that read off their own object
          // continue to work; forward the MCP request id as `toolCallId`
          // (only when present — never coerce undefined to 'undefined').
          // Discard parsed.data: the SDK already ran field transforms when it
          // parsed `args` against the shape (InferShape = each field's _output),
          // so passing parsed.data would transform a SECOND time. The re-parse
          // above is only a validation gate for object-level refinements.
          const result: unknown = await execute.call(def, args as never, {
            toolCallId: extraInfo.requestId !== undefined ? String(extraInfo.requestId) : undefined,
            abortSignal: extraInfo.signal,
          });
          const normalized = await normalizeToolResultToText(toolName, result);
          if ('isError' in normalized) {
            return normalized.isError;
          }
          return { content: [{ type: 'text', text: normalized.text }] };
        } catch (error) {
          return buildIsErrorResult(error instanceof Error ? error.message : String(error));
        }
      }
    );
  });
  return createSdkMcpServer({ name, tools: defs });
}
