/**
 * Example: External MCP Server (Filesystem)
 *
 * Demonstrates a working external MCP server configuration using the official
 * @modelcontextprotocol/server-filesystem package via stdio, restricted to
 * read-only access: `permissionMode: 'dontAsk'` denies every tool call that
 * would need approval, and `allowedTools` pre-approves only the read tools.
 * The prompt ends with a write_file attempt to show that it is denied.
 *
 * Requirements:
 *   - npm run build
 *   - claude auth login
 *   - Node.js >= 22
 *
 * Run:
 *   npx tsx examples/mcp-filesystem.ts
 */

import { streamText } from 'ai';
import { createClaudeCode } from '../dist/index.js';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

async function main() {
  const verboseLogs = process.env.CLAUDE_EXAMPLE_VERBOSE === '1';
  const requestedDir = process.argv[2];
  const targetDir = resolve(requestedDir ?? process.cwd());

  const preferredFiles = ['package.json', 'README.md', 'AGENTS.md'];
  const targetFile =
    preferredFiles.map((file) => resolve(targetDir, file)).find((file) => existsSync(file)) ??
    undefined;

  const pathInstruction = JSON.stringify(targetDir);
  const fileInstruction = targetFile ? JSON.stringify(targetFile) : undefined;
  const provider = createClaudeCode({
    defaultSettings: {
      cwd: targetDir,
      // 'dontAsk' denies any call that would need approval instead of
      // prompting, so only pre-approved tools (and calls that never need
      // approval) can run. Do not use 'bypassPermissions' here: it approves
      // every tool, including the MCP write tools, regardless of allowedTools.
      permissionMode: 'dontAsk',
      mcpServers: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', targetDir],
        },
      },
      // Pre-approve only the read-only filesystem MCP tools. Under 'dontAsk',
      // every other MCP tool (write_file, edit_file, move_file, ...) is denied.
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

  // The write_file probe targets a file inside a directory this run creates
  // atomically, so the cleanup below can only ever remove what this run owns.
  const probeDir = mkdtempSync(join(targetDir, 'mcp-write-probe-'));
  const probeFile = join(probeDir, 'probe.txt');

  // The probe passes only if the permission system denied this exact
  // write_file call. A missing file alone proves nothing: Claude might not
  // have attempted the write, or the server might have rejected it for
  // another reason (for example, a path outside its allowed directories).
  const probeCallIds = new Set<string>();
  const deniedCallIds = new Set<string>();
  let sawStreamError = false;
  let probeWritten = false;

  try {
    // write_file is not pre-approved, so this attempt must be denied.
    const writeInstruction = `Finally, call write_file to create ${JSON.stringify(probeFile)} with the content "probe", and report whether it was allowed.`;

    const prompt = targetFile
      ? `Use MCP filesystem tools with ONLY these absolute paths:
1) Call list_allowed_directories.
2) Call list_directory with path ${pathInstruction} exactly.
3) Call read_text_file with path ${fileInstruction} exactly.
Do not call list_directory on "/" and do not access any path outside ${pathInstruction}.
${writeInstruction}`
      : `Use MCP filesystem tools with ONLY these absolute paths:
1) Call list_allowed_directories.
2) Call list_directory with path ${pathInstruction} exactly.
Do not call list_directory on "/" and do not access any path outside ${pathInstruction}.
${writeInstruction}`;

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

    for await (const part of result.stream) {
      switch (part.type) {
        case 'tool-call':
          console.log(`TOOL CALL: ${part.toolName} (${part.toolCallId})`);
          if (isWriteTo(part.toolName, part.input, probeFile)) probeCallIds.add(part.toolCallId);
          break;
        case 'tool-result':
          console.log(
            `${'isError' in part && part.isError === true ? 'TOOL ERROR' : 'TOOL RESULT'}: ${part.toolName} (${part.toolCallId})`
          );
          {
            const output = part.output;
            if (output !== undefined) {
              console.dir(output, { depth: 6 });
            } else {
              console.log('(no structured tool output payload)');
            }
          }
          break;
        case 'tool-error':
          console.error(`TOOL ERROR: ${part.toolName} -> ${String(part.error)}`);
          break;
        case 'text-delta': {
          process.stdout.write(part.text);
          break;
        }
        case 'finish-step':
          // The provider reports permission denials with the denied tool call IDs.
          for (const id of deniedToolCallIds(part.providerMetadata)) deniedCallIds.add(id);
          break;
        case 'error':
          sawStreamError = true;
          console.error('STREAM ERROR:', part.error);
          break;
        case 'finish':
          console.log('\n\nDone.');
          break;
        default:
          break;
      }
    }
  } finally {
    // Runs even if the stream throws, so an unexpected write never lingers.
    probeWritten = existsSync(probeFile);
    rmSync(probeDir, { recursive: true, force: true });
    if (probeWritten) {
      process.exitCode = 1;
      console.error(`\nFAIL: write_file created ${probeFile} (removed). Writes were NOT blocked.`);
    }
  }

  if (probeWritten) return;
  const inconclusive = (reason: string) => {
    process.exitCode = 1;
    console.error(`\nINCONCLUSIVE: ${reason}, so read-only enforcement was not demonstrated.`);
  };
  if (sawStreamError) {
    inconclusive('the stream reported an error');
  } else if (probeCallIds.size === 0) {
    inconclusive('Claude did not attempt the write_file probe');
  } else if (![...probeCallIds].some((id) => deniedCallIds.has(id))) {
    inconclusive('the write_file probe was not denied by the permission system');
  } else {
    console.log(
      `\nWrite blocked: the permission system denied write_file, and no probe file was created.`
    );
  }
}

// True when a tool call is the filesystem server's write_file targeting `path`.
function isWriteTo(toolName: string, input: unknown, path: string): boolean {
  let args = input;
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      return false;
    }
  }
  return (
    toolName === 'mcp__filesystem__write_file' &&
    typeof args === 'object' &&
    args !== null &&
    (args as { path?: unknown }).path === path
  );
}

// Tool call IDs from providerMetadata['claude-code'].permissionDenials.
function deniedToolCallIds(providerMetadata: unknown): string[] {
  const denials = (
    providerMetadata as { 'claude-code'?: { permissionDenials?: unknown } } | undefined
  )?.['claude-code']?.permissionDenials;
  if (!Array.isArray(denials)) return [];
  return denials
    .map((denial) => (denial as { toolUseId?: unknown }).toolUseId)
    .filter((id): id is string => typeof id === 'string');
}

main().catch((error) => {
  console.error('Example failed:', error);
  process.exit(1);
});
