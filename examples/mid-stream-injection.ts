/**
 * Mid-stream injection example for Claude Code AI SDK Provider.
 *
 * This example shows how to re-steer a running query by sending an
 * additional user message via the underlying Query object.
 */

import { streamText } from 'ai';
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import { claudeCode, type Query } from '../dist/index.js';

type SdkUserMessage = {
  type: 'user';
  message: {
    role: 'user';
    content: Array<{ type: 'text'; text: string }>;
  };
  parent_tool_use_id: null;
  session_id: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toSdkUserMessage = (text: string, sessionId = ''): SdkUserMessage => ({
  type: 'user',
  message: {
    role: 'user',
    content: [{ type: 'text', text }],
  },
  parent_tool_use_id: null,
  session_id: sessionId,
});

async function* singleMessage(text: string, sessionId = '') {
  yield toSdkUserMessage(text, sessionId);
}

const allowAllTools: CanUseTool = async (_toolName, input) => ({
  behavior: 'allow',
  updatedInput: input,
});

async function main() {
  let activeQuery: Query | undefined;
  let injected = false;
  let streamedChars = 0;
  let sessionId: string | undefined;

  const tryInject = async () => {
    if (injected || !activeQuery) return;
    injected = true;
    await sleep(400);

    try {
      await activeQuery.streamInput(
        singleMessage(
          'Mid-stream update: switch to nautical metaphors and add a short 3-bullet list of benefits.',
          sessionId ?? ''
        )
      );
      console.log('\n\n[Injected a mid-stream update]\n');
    } catch (error) {
      console.error('\n[Failed to inject mid-stream update]', error);
    }
  };

  const model = claudeCode('sonnet', {
    streamingInput: 'always',
    canUseTool: allowAllTools,
    permissionMode: 'bypassPermissions',
    allowedTools: ['Bash'],
    cwd: process.cwd(),
    onQueryCreated: (query) => {
      activeQuery = query;
      void tryInject();
    },
  });

  const result = streamText({
    model,
    prompt:
      'Write the first paragraph of a product pitch for a coffee subscription. Then run the Bash command `sleep 2` before continuing with the remaining paragraph. Be upbeat and detailed.',
  });

  console.log('--- Streaming response (watch for the tone shift) ---\n');

  const stream = result.fullStream as AsyncIterable<unknown>;

  for await (const part of stream) {
    if (!part || typeof part !== 'object') continue;
    const typed = part as {
      type?: string;
      id?: string;
      delta?: unknown;
      text?: unknown;
    };

    if (typed.type === 'response-metadata') {
      sessionId = typed.id;
      void tryInject();
    }

    if (typed.type === 'tool-call') {
      void tryInject();
    }

    if (typed.type === 'text-delta') {
      const chunk = typed.delta ?? typed.text;
      if (typeof chunk === 'string') {
        process.stdout.write(chunk);
        streamedChars += chunk.length;

        if (streamedChars > 200) {
          void tryInject();
        }
      }
    }
  }

  console.log('\n');
}

main().catch((error) => {
  console.error('Example failed:', error);
  process.exitCode = 1;
});
