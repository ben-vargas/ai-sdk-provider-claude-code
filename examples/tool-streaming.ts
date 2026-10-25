/**
 * Example: Tool Streaming Events
 *
 * Streams a conversation that triggers Claude Code's built-in tools and prints the
 * intermediate tool events emitted by the Vercel AI SDK integration.
 *
 * Requirements:
 *   - `npm run build` (so ../dist is up to date)
 *   - `claude auth login` and the CLI tools available on your PATH
 *   - Node.js ≥ 18
 */

import { streamText } from 'ai';
import { claudeCode } from '../dist/index.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

async function main() {
  const exampleRoot = dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = resolve(exampleRoot, '..');
  const readmePath = resolve(workspaceRoot, 'README.md');

  const result = streamText({
    model: claudeCode('opus', {
      // Pre-approve the two built-in tools this prompt needs. (A `canUseTool`
      // callback would never run for them: bare allowedTools entries and
      // `permissionMode: 'bypassPermissions'` both approve calls before the
      // callback is consulted.)
      allowedTools: ['Bash', 'Read'],
      cwd: workspaceRoot,
    }),
    prompt: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `List the project directory and then read ${readmePath}. Summarize the findings once the tools finish.`,
          },
        ],
      },
    ],
  });

  console.log('Listening for tool and text events...\n');

  const stream = result.fullStream as AsyncIterable<any>;

  for await (const part of stream) {
    switch (part.type) {
      case 'start':
        console.log('⚙️ generation started');
        break;
      case 'start-step':
        console.log('➡️ start-step', part.request ?? {});
        break;
      case 'stream-start':
        console.log('⚡ stream-start');
        if (Array.isArray(part.warnings) && part.warnings.length > 0) {
          console.log(
            '  warnings:',
            part.warnings.map((warning: unknown) => JSON.stringify(warning))
          );
        }
        break;
      case 'response-metadata':
        console.log(`ℹ️ session ${part.id ?? 'unknown'} (model ${part.modelId ?? 'unknown'})`);
        break;
      case 'tool-input-start':
        console.log(`🔧 tool-input-start → ${part.toolName} (${part.id})`);
        break;
      case 'tool-input-delta':
        console.log(`   ↳ input delta: ${part.delta}`);
        break;
      case 'tool-input-end':
        console.log(`   ↳ input end (${part.id})`);
        break;
      case 'tool-call':
        console.log(`🚀 tool-call → ${part.toolName} (${part.toolCallId})`);
        break;
      case 'tool-error':
        console.error('⚠️ tool-error:', part.toolName, part.error);
        break;
      case 'tool-result': {
        console.log(`📄 tool-result ← ${part.toolName} (${part.toolCallId})`);
        const toolResult = part.result ?? part.output;
        if (toolResult !== undefined) {
          console.dir(toolResult, { depth: 4 });
        } else {
          console.log('   (provider reported no structured result)');
        }
        break;
      }
      case 'text-start':
        console.log('💬 text-start');
        break;
      case 'text-delta':
        {
          const chunk = part.delta ?? part.text;
          if (typeof chunk === 'string') {
            process.stdout.write(chunk);
          } else {
            console.dir(chunk, { depth: 2 });
          }
        }
        break;
      case 'text-end':
        console.log('\n💬 text-end\n');
        break;
      case 'finish':
        console.log('✅ finish', part.finishReason);
        console.log('   usage:', part.usage ?? part.totalUsage);
        break;
      case 'error':
        console.error('❌ error part:', part.error);
        break;
      default:
        console.log('⋯ other part:', part);
        break;
    }
  }
}

main().catch((error) => {
  console.error('Example failed:', error);
  process.exitCode = 1;
});
