import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
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

export function createCustomMcpServer<
  Tools extends Record<
    string,
    {
      description: string;
      inputSchema: ZodObject<ZodRawShape>;
      handler: (args: Record<string, unknown>, extra: unknown) => Promise<MinimalCallToolResult>;
    }
  >,
>(config: { name: string; version?: string; tools: Tools }): McpSdkServerConfigWithInstance {
  const defs = Object.entries(config.tools).map(([name, def]) =>
    tool(
      name,
      def.description,
      def.inputSchema.shape as ZodRawShape,
      (args: Record<string, unknown>, extra: unknown) => def.handler(args, extra)
    )
  );
  return createSdkMcpServer({ name: config.name, version: config.version, tools: defs });
}
