/**
 * Example: Mid-Session Message Injection
 *
 * Demonstrates how to inject messages into an active Claude Code session.
 * Shows stream events to understand when injection can/cannot occur.
 *
 * Usage: npx tsx examples/message-injection.ts
 */

import { streamText } from 'ai';
import { createClaudeCode, type MessageInjector } from '../dist/index.js';

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
  console.log(`${DIM}Task: Write 5 files. Inject after 3 seconds.${RESET}\n`);

  let injector: MessageInjector | null = null;

  const provider = createClaudeCode({
    defaultSettings: {
      streamingInput: 'always',
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      allowedTools: ['Write'],
      onStreamStart: (inj) => {
        injector = inj;
        console.log(`${timestamp()} ${GREEN}SESSION STARTED${RESET}`);

        setTimeout(() => {
          console.log(`${timestamp()} ${YELLOW}>>> INJECT QUEUED: "STOP!"${RESET}`);
          injector!.inject('STOP! Do not write more files. Say how many you created.', (delivered) => {
            console.log(`${timestamp()} ${delivered ? GREEN + '✓ DELIVERED' : RED + '✗ NOT DELIVERED'}${RESET}`);
          });
        }, 3000);
      },
    },
  });

  const result = streamText({
    model: provider('haiku'),
    prompt: 'Write 5 files: /tmp/inj-demo/a.txt through e.txt. Each with "hello". One at a time.',
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
      if (inText) { console.log(''); inText = false; }
      console.log(`${timestamp()} ${CYAN}TOOL-CALL: ${part.toolName}${RESET}`);
    } else if (part.type === 'tool-result') {
      console.log(`${timestamp()} ${CYAN}TOOL-RESULT${RESET}`);
    } else if (part.type === 'finish') {
      if (inText) { console.log(''); inText = false; }
      console.log(`${timestamp()} ${GREEN}FINISH${RESET}`);
    }
  }

  console.log('');
  const { execSync } = await import('child_process');
  try { execSync('rm -rf /tmp/inj-demo'); } catch {}
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

  const provider = createClaudeCode({
    defaultSettings: {
      streamingInput: 'always',
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      allowedTools: ['Read'],
      onStreamStart: (inj) => {
        injector = inj;
        console.log(`${timestamp()} ${GREEN}SESSION STARTED${RESET}`);
      },
    },
  });

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
      if (inText) { console.log(''); inText = false; }
      console.log(`${timestamp()} ${CYAN}TOOL-CALL: ${part.toolName}${RESET}`);
    } else if (part.type === 'tool-result') {
      console.log(`${timestamp()} ${CYAN}TOOL-RESULT${RESET}`);
    } else if (part.type === 'finish') {
      if (inText) { console.log(''); inText = false; }
      console.log(`${timestamp()} ${GREEN}FINISH${RESET}`);
      // Inject AFTER session ends - too late!
      const msg = 'What is the first line of /etc/hosts?';
      console.log(`${timestamp()} ${YELLOW}>>> INJECT QUEUED after finish (too late!)${RESET}`);
      injector!.inject(msg, (delivered) => {
        if (!delivered) {
          console.log(`${timestamp()} ${GREEN}✓ NOT DELIVERED detected - saving for recovery${RESET}`);
          missedMessage = msg;
        }
      });
    }
  }

  // Recovery: send missed message as a new turn
  if (missedMessage) {
    console.log(`${timestamp()} ${YELLOW}>>> RECOVERING: sending missed message as new prompt${RESET}`);
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
        if (inText) { console.log(''); inText = false; }
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
