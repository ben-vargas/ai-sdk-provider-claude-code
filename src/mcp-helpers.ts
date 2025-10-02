import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { type ZodRawShape, type ZodObject } from 'zod';

/**
 * Convenience helper to create an SDK MCP server from a simple tool map.
 * Each tool provides a description, a Zod object schema, and a handler.
 */
export type MinimalCallToolResult = {
  content: Array<{ type: string; [key: string]: unknown }>;
  isError?: boolean;
  structuredContent?: unknown;
};

export function createCustomMcpServer<Tools extends Record<string, {
  description: string;
  inputSchema: ZodObject<ZodRawShape>;
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<MinimalCallToolResult>;
}>>(config: {
  name: string;
  version?: string;
  tools: Tools;
}): McpSdkServerConfigWithInstance {
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
