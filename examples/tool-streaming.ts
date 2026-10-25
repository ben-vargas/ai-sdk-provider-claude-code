/**
 * Example: Tool Streaming Events
 *
 * Streams a conversation that triggers Claude Code's built-in tools and prints the
 * intermediate tool events emitted by the Vercel AI SDK integration.
 *
 * Requirements:
 *   - `npm run build` (so ../dist is up to date)
 *   - `claude auth login` and the CLI tools available on your PATH
 *   - Node.js ≥ 22
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

  const stream = result.stream;

  for await (const part of stream) {
    switch (part.type) {
      case 'start':
        console.log('⚙️ generation started');
        break;
      case 'start-step':
        console.log('➡️ start-step', part.request);
        if (part.warnings.length > 0) {
          console.log(
            '  warnings:',
            part.warnings.map((warning) => JSON.stringify(warning))
          );
        }
        break;
      case 'finish-step': {
        const metadata = part.providerMetadata?.['claude-code'] as
          | { sessionId?: string }
          | undefined;
        const session = metadata?.sessionId ? `, session ${metadata.sessionId}` : '';
        console.log(`ℹ️ response ${part.response.id} (model ${part.response.modelId}${session})`);
        console.log('   step usage:', part.usage);
        break;
      }
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
      case 'tool-result':
        console.log(`📄 tool-result ← ${part.toolName} (${part.toolCallId})`);
        console.dir(part.output, { depth: 4 });
        break;
      // The provider reports failed tools as `tool-result` with `isError: true`;
      // streamText surfaces those to you as `tool-error` parts.
      case 'tool-error':
        console.log(`⚠️ tool-error ← ${part.toolName} (${part.toolCallId})`);
        console.dir(part.error, { depth: 4 });
        break;
      case 'text-start':
        console.log('💬 text-start');
        break;
      case 'text-delta':
        process.stdout.write(part.text);
        break;
      case 'text-end':
        console.log('\n💬 text-end\n');
        break;
      case 'finish':
        console.log('✅ finish', part.finishReason);
        console.log('   total usage:', part.totalUsage);
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
