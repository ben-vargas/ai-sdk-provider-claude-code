/**
 * Example: Bridging AI SDK tools (createAiSdkMcpServer)
 *
 * The Claude Code CLI executes its own tools, so AI SDK tools passed to
 * generateText/streamText via the `tools` option cannot be auto-bridged by
 * the provider (the `execute` functions never reach the provider layer).
 *
 * Instead, bridge them explicitly: createAiSdkMcpServer turns a map of AI SDK
 * tools (the `ai` package's tool() helper, Zod schemas only) into an
 * in-process SDK MCP server. Wire it via `mcpServers` and allow the tools
 * with `allowedTools` using the mcp__<serverName>__<toolName> naming.
 *
 * Tool calls/results surface as provider-executed dynamic tool parts on both
 * paths: in generateText steps content and in the streamText fullStream.
 */

import { z } from 'zod';
import { generateText, streamText, tool } from 'ai';
import { createClaudeCode, createAiSdkMcpServer } from '../dist/index.js';
// NOTE: Migrating to Claude Agent SDK:
// - System prompt is not applied by default
// - Filesystem settings (CLAUDE.md, settings.json) are not loaded by default
// To restore old behavior, set when creating model instances, e.g.:
//   systemPrompt: { type: 'preset', preset: 'claude_code' }
//   settingSources: ['user', 'project', 'local']

// Two simple AI SDK tools, defined exactly as you would for any AI SDK provider
const tools = {
  calculator: tool({
    description: 'Evaluate a basic arithmetic operation on two numbers',
    inputSchema: z.object({
      operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
      a: z.number(),
      b: z.number(),
    }),
    execute: async ({ operation, a, b }) => {
      // Log so the generateText example below visibly shows the bridged
      // tool running in-process.
      console.log(`🔧 calculator executed in-process: ${operation}(${a}, ${b})`);
      switch (operation) {
        case 'add':
          return { result: a + b };
        case 'subtract':
          return { result: a - b };
        case 'multiply':
          return { result: a * b };
        case 'divide':
          if (b === 0) throw new Error('Cannot divide by zero');
          return { result: a / b };
      }
    },
  }),
  clock: tool({
    description: 'Get the current date and time as an ISO 8601 string',
    inputSchema: z.object({}),
    execute: async () => new Date().toISOString(),
  }),
};

async function main() {
  // Bridge the AI SDK tools into an in-process MCP server
  const provider = createClaudeCode({
    defaultSettings: {
      mcpServers: {
        myTools: createAiSdkMcpServer('myTools', tools),
      },
      // Tools are exposed to the CLI as mcp__<serverName>__<toolName>
      allowedTools: ['mcp__myTools__calculator', 'mcp__myTools__clock'],
    },
  });

  // 1. generateText - tool calls/results appear in the steps content
  console.log('1️⃣  generateText with bridged AI SDK tools\n');
  const result = await generateText({
    model: provider('sonnet'),
    prompt: 'Use the calculator tool to multiply 12 by 34. Reply with just the number.',
  });

  for (const part of result.steps.flatMap((step) => step.content)) {
    if (part.type === 'tool-call') {
      console.log(`🚀 tool-call → ${part.toolName}`, JSON.stringify(part.input));
    } else if (part.type === 'tool-result') {
      console.log(`📄 tool-result ← ${part.toolName}`, JSON.stringify(part.output));
    }
  }
  console.log('Response:', result.text.trim());

  // 2. streamText - tool calls/results arrive as dynamic tool parts
  console.log('\n2️⃣  streamText with bridged AI SDK tools\n');
  const stream = streamText({
    model: provider('sonnet'),
    prompt: 'What time is it right now? Use the clock tool, then answer in one sentence.',
  });

  let text = '';
  for await (const part of stream.fullStream) {
    if (part.type === 'tool-call') {
      console.log(`🚀 tool-call → ${part.toolName}`, JSON.stringify(part.input));
    } else if (part.type === 'tool-result') {
      console.log(`📄 tool-result ← ${part.toolName}`, JSON.stringify(part.output));
    } else if (part.type === 'text-delta') {
      text += part.text;
    }
  }
  console.log('Response:', text.trim());

  console.log('\n✅ AI SDK tools bridged successfully!');
  console.log('\n📝 Key Points:');
  console.log('- The provider cannot auto-bridge the AI SDK `tools` option (execute stays local)');
  console.log('- createAiSdkMcpServer runs your execute functions in-process via MCP');
  console.log('- Only Zod object schemas are supported (no jsonSchema() tools)');
  console.log('- Allow the tools explicitly: mcp__<serverName>__<toolName>');
  console.log('- Tool-call/tool-result parts surface in generateText steps and when streaming');
}

main().catch((err) => {
  console.error('Example failed:', err);
  process.exit(1);
});
