/**
 * Thinking traces example for Claude Code AI SDK Provider
 *
 * Demonstrates how to access extended thinking (reasoning) traces
 * in both streaming and non-streaming modes.
 *
 * Usage: npx tsx examples/thinking-traces.ts
 */

import { generateText, streamText } from 'ai';
import { claudeCode } from '../dist/index.js';

const PROMPT = 'What is 27 * 43? Think through it step by step.';

async function nonStreamingExample() {
  console.log('=== Non-Streaming (generateText) ===\n');

  const result = await generateText({
    model: claudeCode('sonnet', {
      thinking: { type: 'enabled', budgetTokens: 10000 },
    }),
    prompt: PROMPT,
  });

  // Reasoning parts come before the text part in the content array
  for (const message of result.response.messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === 'reasoning') {
        console.log('[Reasoning]', part.text);
      } else if (part.type === 'text') {
        console.log('\n[Answer]', part.text);
      }
    }
  }

  // Also available in providerMetadata
  const metadata = result.providerMetadata?.['claude-code'] as Record<string, unknown> | undefined;
  if (metadata?.thinkingTraces) {
    console.log(
      `\nProvider metadata: ${(metadata.thinkingTraces as string[]).length} reasoning trace(s)`
    );
  }
}

async function streamingExample() {
  console.log('\n=== Streaming (streamText) ===\n');

  const result = streamText({
    model: claudeCode('sonnet', {
      thinking: { type: 'enabled', budgetTokens: 10000 },
    }),
    prompt: PROMPT,
  });

  // fullStream emits reasoning-start/delta/end and text-delta events
  // AI SDK v6 uses .text on reasoning-delta and .text on text-delta from fullStream
  for await (const part of result.fullStream) {
    if (part.type === 'reasoning-start') {
      process.stdout.write('[Reasoning] ');
    } else if (part.type === 'reasoning-delta') {
      process.stdout.write(part.text);
    } else if (part.type === 'reasoning-end') {
      process.stdout.write('\n\n[Answer] ');
    } else if (part.type === 'text-delta') {
      process.stdout.write(part.text);
    }
  }

  console.log('\n');
}

async function main() {
  try {
    await nonStreamingExample();
    await streamingExample();
  } catch (error) {
    console.error('Error:', error);
    console.log('\nTroubleshooting:');
    console.log('1. Install Claude Code: https://docs.anthropic.com/en/docs/claude-code/overview');
    console.log('2. Authenticate: claude auth login');
    console.log('3. Thinking requires a model that supports extended thinking');
  }
}

main().catch(console.error);
