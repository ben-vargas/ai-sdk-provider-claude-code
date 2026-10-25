/**
 * Example: Mid-Session Message Injection
 *
 * Demonstrates how to inject messages into an active Claude Code session.
 * Shows stream events to understand when injection can/cannot occur.
 *
 * Usage: npx tsx examples/message-injection.ts
 */

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { streamText } from 'ai';
import { createClaudeCode } from '../dist/index.js';
import type { ClaudeCodeSettings, MessageInjector } from '../src/types.js';

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function timestamp() {
  return `${DIM}[${(performance.now() / 1000).toFixed(2)}s]${RESET}`;
}

/**
 * Example 1: Multiple tool calls - injection succeeds
 */
async function multipleToolCalls() {
  console.log(`\n${CYAN}═══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}  EXAMPLE 1: Multiple Tool Calls${RESET}`);
  console.log(`${CYAN}═══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${DIM}Task: Write 5 files. Inject "STOP" after the 2nd file is written.${RESET}\n`);

  // Scratch working directory, so the demo never writes into your project.
  const demoDir = await mkdtemp(join(tmpdir(), 'inj-demo-'));
  // Held in an object so TypeScript doesn't narrow it to `null` across the
  // onStreamStart callback.
  const injectionState: { injector: MessageInjector | null } = { injector: null };

  const defaultSettings: ClaudeCodeSettings = {
    streamingInput: 'always',
    cwd: demoDir,
    // acceptEdits auto-approves file edits inside cwd (the scratch dir). It
    // also auto-approves filesystem Bash commands such as `touch` or `cp`, so
    // deny Bash to make Write the only way to create the files.
    permissionMode: 'acceptEdits',
    disallowedTools: ['Bash'],
    onStreamStart: (inj: MessageInjector) => {
      injectionState.injector = inj;
      console.log(`${timestamp()} ${GREEN}SESSION STARTED${RESET}`);
    },
  };

  const provider = createClaudeCode({ defaultSettings });

  const result = streamText({
    model: provider('haiku'),
    prompt:
      'Write 5 files in the current directory: a.txt, b.txt, c.txt, d.txt and e.txt, ' +
      'each containing "hello". Write them one at a time, one tool call per file.',
  });

  let inText = false;
  let filesWritten = 0;
  try {
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        if (!inText) {
          process.stdout.write(`${timestamp()} ${CYAN}TEXT:${RESET} `);
          inText = true;
        }
        process.stdout.write(part.text);
      } else if (part.type === 'tool-call') {
        if (inText) {
          console.log('');
          inText = false;
        }
        console.log(`${timestamp()} ${CYAN}TOOL-CALL: ${part.toolName}${RESET}`);
      } else if (part.type === 'tool-result' || part.type === 'tool-error') {
        console.log(`${timestamp()} ${CYAN}${part.type.toUpperCase()}${RESET}`);
        // Count only successful Write results, i.e. files actually written.
        if (part.type === 'tool-result' && part.toolName === 'Write') {
          filesWritten += 1;
        }
        if (filesWritten === 2 && part.type === 'tool-result' && part.toolName === 'Write') {
          const activeInjector = injectionState.injector;
          console.log(`${timestamp()} ${YELLOW}>>> INJECT QUEUED: "STOP!"${RESET}`);
          if (activeInjector === null) {
            console.log(`${timestamp()} ${RED}✗ INJECTOR NOT READY${RESET}`);
          } else {
            activeInjector.inject(
              'STOP! Do not write more files. Say how many you created.',
              (delivered: boolean) => {
                console.log(
                  `${timestamp()} ${delivered ? GREEN + '✓ DELIVERED' : RED + '✗ NOT DELIVERED'}${RESET}`
                );
              }
            );
          }
        }
      } else if (part.type === 'finish') {
        if (inText) {
          console.log('');
          inText = false;
        }
        console.log(`${timestamp()} ${GREEN}FINISH${RESET}`);
      }
    }

    // The files on disk show whether the agent actually stopped early.
    const written = (await readdir(demoDir)).filter((name) => name.endsWith('.txt')).sort();
    console.log(
      `${timestamp()} ${GREEN}Files on disk: ${written.length} of 5${RESET} ${DIM}(${written.join(', ') || 'none'})${RESET}`
    );
  } finally {
    await rm(demoDir, { recursive: true, force: true });
  }
  console.log('');
}

/**
 * Example 2: Too late - inject after session ends, then recover
 */
async function tooLateWithRecovery() {
  console.log(`\n${CYAN}═══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}  EXAMPLE 2: Too Late + Recovery${RESET}`);
  console.log(`${CYAN}═══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${DIM}Task: Quick task. Inject after finish fails, then recover.${RESET}\n`);

  let injector: MessageInjector | null = null;
  let missedMessage: string | null = null;

  const defaultSettings: ClaudeCodeSettings = {
    streamingInput: 'always',
    // Pre-approve Read so the agent can read /etc/hosts without a prompt.
    allowedTools: ['Read'],
    onStreamStart: (inj: MessageInjector) => {
      injector = inj;
      console.log(`${timestamp()} ${GREEN}SESSION STARTED${RESET}`);
    },
  };

  const provider = createClaudeCode({ defaultSettings });

  const result = streamText({
    model: provider('haiku'),
    prompt: 'Read /etc/hosts and say how many lines. Be brief.',
  });

  let inText = false;
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      if (!inText) {
        process.stdout.write(`${timestamp()} ${CYAN}TEXT:${RESET} `);
        inText = true;
      }
      process.stdout.write(part.text);
    } else if (part.type === 'tool-call') {
      if (inText) {
        console.log('');
        inText = false;
      }
      console.log(`${timestamp()} ${CYAN}TOOL-CALL: ${part.toolName}${RESET}`);
    } else if (part.type === 'tool-result') {
      console.log(`${timestamp()} ${CYAN}TOOL-RESULT${RESET}`);
    } else if (part.type === 'finish') {
      if (inText) {
        console.log('');
        inText = false;
      }
      console.log(`${timestamp()} ${GREEN}FINISH${RESET}`);
      // Inject AFTER session ends - too late!
      const msg = 'What is the first line of /etc/hosts?';
      console.log(`${timestamp()} ${YELLOW}>>> INJECT QUEUED after finish (too late!)${RESET}`);
      injector!.inject(msg, (delivered) => {
        if (!delivered) {
          console.log(
            `${timestamp()} ${GREEN}✓ NOT DELIVERED detected - saving for recovery${RESET}`
          );
          missedMessage = msg;
        }
      });
    }
  }

  // Recovery: send missed message as a new turn
  if (missedMessage) {
    console.log(
      `${timestamp()} ${YELLOW}>>> RECOVERING: sending missed message as new prompt${RESET}`
    );
    const recovery = streamText({
      model: provider('haiku'),
      prompt: missedMessage,
    });
    for await (const part of recovery.fullStream) {
      if (part.type === 'text-delta') {
        if (!inText) {
          process.stdout.write(`${timestamp()} ${CYAN}TEXT:${RESET} `);
          inText = true;
        }
        process.stdout.write(part.text);
      } else if (part.type === 'finish') {
        if (inText) {
          console.log('');
          inText = false;
        }
        console.log(`${timestamp()} ${GREEN}FINISH (recovery complete)${RESET}`);
      }
    }
  }

  console.log('');
}

async function main() {
  console.log(`${CYAN}Message Injection Examples${RESET}`);
  console.log(`${DIM}Timestamps show when each event occurs.${RESET}`);

  await multipleToolCalls();
  await tooLateWithRecovery();

  console.log(`\n${CYAN}═══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${DIM}The delivery callback lets you know if injection succeeded`);
  console.log(`or failed, enabling recovery patterns like Example 2.${RESET}\n`);
}

main().catch((err) => {
  console.error('Example failed:', err);
  process.exit(1);
});
