/**
 * Example: External MCP Server (Filesystem)
 *
 * Demonstrates a working external MCP server configuration using the official
 * @modelcontextprotocol/server-filesystem package via stdio.
 *
 * Requirements:
 *   - npm run build
 *   - claude login
 *   - Node.js >= 18
 *
 * Run:
 *   npx tsx examples/mcp-filesystem.ts
 */

import { streamText } from 'ai';
import { createClaudeCode } from '../dist/index.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

async function main() {
  const verboseLogs = process.env.CLAUDE_EXAMPLE_VERBOSE === '1';
  const examplesDir = dirname(fileURLToPath(import.meta.url));
  const requestedDir = process.argv[2];
  const targetDir = resolve(requestedDir ?? process.cwd());

  const preferredFiles = ['package.json', 'README.md', 'AGENTS.md'];
  const targetFile =
    preferredFiles.map((file) => resolve(targetDir, file)).find((file) => existsSync(file)) ??
    undefined;

  const pathInstruction = JSON.stringify(targetDir);
  const fileInstruction = targetFile ? JSON.stringify(targetFile) : undefined;

  const prompt = targetFile
    ? `Use MCP filesystem tools with ONLY these absolute paths:
1) Call list_allowed_directories.
2) Call list_directory with path ${pathInstruction} exactly.
3) Call read_text_file with path ${fileInstruction} exactly.
Do not call list_directory on "/" and do not access any path outside ${pathInstruction}.`
    : `Use MCP filesystem tools with ONLY these absolute paths:
1) Call list_allowed_directories.
2) Call list_directory with path ${pathInstruction} exactly.
Do not call list_directory on "/" and do not access any path outside ${pathInstruction}.`;

  const provider = createClaudeCode({
    defaultSettings: {
      cwd: targetDir,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      mcpServers: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', targetDir],
        },
      },
      // Restrict to read-only filesystem MCP tools.
      allowedTools: [
        'mcp__filesystem__list_allowed_directories',
        'mcp__filesystem__list_directory',
        'mcp__filesystem__read_text_file',
      ],
    },
  });

  console.log(`Target directory: ${targetDir}`);
  console.log(
    `Verbose provider logs: ${verboseLogs ? 'enabled' : 'disabled'} (set CLAUDE_EXAMPLE_VERBOSE=1 to enable)`
  );
  if (targetFile) {
    console.log(`Preferred file to read: ${targetFile}`);
  } else {
    console.log('Preferred file to read: none found in target directory (listing only)');
  }

  const result = streamText({
    model: provider('sonnet', {
      // stream events make it easier to confirm that MCP tool calls happened
      streamingInput: 'always',
      includePartialMessages: true,
      verbose: verboseLogs,
      maxToolResultSize: 200_000,
    }),
    prompt,
  });

  console.log('Streaming output (with MCP tool events):\n');

  const stream = result.fullStream as AsyncIterable<any>;
  for await (const part of stream) {
    switch (part.type) {
      case 'tool-call':
        console.log(`TOOL CALL: ${part.toolName} (${part.toolCallId})`);
        break;
      case 'tool-result':
        console.log(`TOOL RESULT: ${part.toolName} (${part.toolCallId})`);
        {
          const output = part.result ?? part.output;
          if (output !== undefined) {
            console.dir(output, { depth: 6 });
          } else {
            console.log('(no structured tool output payload)');
          }
        }
        break;
      case 'tool-error':
        console.error(`TOOL ERROR: ${part.toolName} -> ${part.error}`);
        break;
      case 'text-delta':
        if (typeof part.delta === 'string') {
          process.stdout.write(part.delta);
        }
        break;
      case 'finish':
        console.log('\n\nDone.');
        break;
      default:
        break;
    }
  }
}

main().catch((error) => {
  console.error('Example failed:', error);
  process.exit(1);
});
