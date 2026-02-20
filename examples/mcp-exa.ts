/**
 * Example: External MCP Server (Exa over HTTP)
 *
 * Demonstrates a working HTTP MCP configuration against Exa's hosted MCP endpoint.
 * Basic usage works without an API key; set EXA_API_KEY (or EXA_MCP_API_KEY)
 * for higher rate limits.
 *
 * Requirements:
 *   - npm run build
 *   - claude auth login
 *   - Node.js >= 18
 *
 * Run:
 *   npx tsx examples/mcp-exa.ts
 */

import { streamText } from 'ai';
import { createClaudeCode } from '../dist/index.js';

const DEFAULT_EXA_ENDPOINT = 'https://mcp.exa.ai/mcp';

function buildExaEndpoint() {
  const endpoint = new URL(process.env.EXA_MCP_URL ?? DEFAULT_EXA_ENDPOINT);

  // Match pi-exa-mcp defaults unless caller already provided `tools` in EXA_MCP_URL.
  if (!endpoint.searchParams.has('tools')) {
    endpoint.searchParams.set('tools', 'web_search_exa,get_code_context_exa');
  }

  const apiKey = process.env.EXA_API_KEY ?? process.env.EXA_MCP_API_KEY;
  if (apiKey && !endpoint.searchParams.has('exaApiKey')) {
    endpoint.searchParams.set('exaApiKey', apiKey);
  }

  return endpoint;
}

function redactEndpoint(endpoint: URL) {
  const redacted = new URL(endpoint.toString());
  if (redacted.searchParams.has('exaApiKey')) {
    redacted.searchParams.set('exaApiKey', 'REDACTED');
  }
  return redacted.toString();
}

async function main() {
  const verboseLogs = process.env.CLAUDE_EXAMPLE_VERBOSE === '1';
  const exaEndpoint = buildExaEndpoint();

  const provider = createClaudeCode({
    defaultSettings: {
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      mcpServers: {
        exa: {
          type: 'http',
          url: exaEndpoint.toString(),
        },
      },
      allowedTools: ['mcp__exa__web_search_exa', 'mcp__exa__get_code_context_exa'],
    },
  });

  console.log(`Using Exa MCP endpoint: ${redactEndpoint(exaEndpoint)}`);
  console.log(
    `Verbose provider logs: ${verboseLogs ? 'enabled' : 'disabled'} (set CLAUDE_EXAMPLE_VERBOSE=1 to enable)`
  );
  console.log('Streaming output (with Exa MCP tool events):\n');

  const result = streamText({
    model: provider('sonnet', {
      streamingInput: 'always',
      includePartialMessages: true,
      verbose: verboseLogs,
      // Keep more tool output in stream events for easier inspection.
      maxToolResultSize: 500_000,
    }),
    prompt:
      'Use web_search_exa to find one recent Vercel AI SDK announcement. Respond in exactly two sentences and include one source URL.',
  });

  const stream = result.fullStream as AsyncIterable<any>;
  for await (const part of stream) {
    switch (part.type) {
      case 'tool-call':
        console.log(`TOOL CALL: ${part.toolName} (${part.toolCallId})`);
        break;
      case 'tool-result': {
        console.log(`TOOL RESULT: ${part.toolName} (${part.toolCallId})`);
        const output = part.result ?? part.output;
        const text =
          typeof output === 'string'
            ? output
            : (() => {
                try {
                  return JSON.stringify(output, null, 2);
                } catch {
                  return String(output);
                }
              })();
        console.log('  Full output:');
        console.log(text);
        break;
      }
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
