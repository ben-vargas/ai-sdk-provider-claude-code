/**
 * Example: SDK MCP Tools (callbacks)
 *
 * Demonstrates defining in-process tools via createSdkMcpServer and tool,
 * wiring them to the provider via mcpServers, and constraining access
 * via allowedTools.
 */

import { z } from 'zod';
import { streamText } from 'ai';
import { createClaudeCode, createSdkMcpServer, tool } from '../dist/index.js';

// Define an in-process tool
const add = tool('add', 'Add two numbers', { a: z.number(), b: z.number() }, async ({ a, b }) => ({
  content: [{ type: 'text', text: String(a + b) }],
}));

// Create SDK MCP server
const sdkServer = createSdkMcpServer({ name: 'local', tools: [add] });

async function main() {
  // Wire the MCP server and restrict to this tool
  const provider = createClaudeCode({
    defaultSettings: {
      mcpServers: { local: sdkServer },
      allowedTools: ['mcp__local__add'],
    },
  });

  const result = streamText({
    model: provider('sonnet'),
    prompt: 'Use the add tool to sum 3 and 4. Provide only the number.',
  });

  let text = '';
  for await (const chunk of result.textStream) text += chunk;
  console.log('Response:', text.trim());
}

main().catch((err) => {
  console.error('Example failed:', err);
  process.exit(1);
});

