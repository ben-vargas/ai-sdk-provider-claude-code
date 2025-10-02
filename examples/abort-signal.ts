import { generateText, streamText } from 'ai';
import { claudeCode } from '../dist/index.js';
// NOTE: Migrating to Claude Agent SDK:
// - System prompt is not applied by default
// - Filesystem settings (CLAUDE.md, settings.json) are not loaded by default
// To restore old behavior, set:
//   systemPrompt: { type: 'preset', preset: 'claude_code' }
//   settingSources: ['user', 'project', 'local']

/**
 * Example: Request Cancellation with AbortController
 *
 * This example demonstrates how to cancel in-progress requests using AbortSignal.
 * Useful for implementing timeouts, user cancellations, or cleaning up on unmount.
 */

// Suppress uncaught abort errors from child processes
process.on('uncaughtException', (err: any) => {
  if (err.code === 'ABORT_ERR') {
    // Silently ignore abort errors - they're expected
    return;
  }
  // Re-throw other errors
  throw err;
});

async function main() {
  console.log('🚀 Testing request cancellation with AbortController\n');

  // Example 1: Cancel a non-streaming request after 2 seconds
  console.log('1. Testing cancellation of generateText after 2 seconds...');
  try {
    const controller = new AbortController();

    // Cancel after 2 seconds
    const timeout = setTimeout(() => {
      console.log('   ⏱️  Cancelling request...');
      controller.abort();
    }, 2000);

    const { text } = await generateText({
      model: claudeCode('sonnet'),
      prompt:
        'Write a very long detailed essay about the history of computing. Include at least 10 paragraphs.',
      abortSignal: controller.signal,
    });

    clearTimeout(timeout);
    console.log('   ✅ Completed:', text.slice(0, 100) + '...');
  } catch (error: any) {
    if (error.name === 'AbortError' || error.message?.includes('aborted')) {
      console.log('   ✅ Request successfully cancelled');
    } else {
      console.error('   ❌ Error:', error.message);
    }
  }

  console.log('\n2. Testing immediate cancellation (before request starts)...');
  try {
    const controller = new AbortController();

    // Cancel immediately
    controller.abort();

    await generateText({
      model: claudeCode('sonnet'),
      prompt: 'This should not execute',
      abortSignal: controller.signal,
    });

    console.log('   ❌ This should not be reached');
  } catch (error: any) {
    if (error.name === 'AbortError' || error.message?.includes('aborted')) {
      console.log('   ✅ Request cancelled before execution');
    } else {
      console.error('   ❌ Error:', error.message);
    }
  }

  console.log('\n3. Testing streaming cancellation after partial response...');
  try {
    const controller = new AbortController();
    let charCount = 0;

    const { textStream } = streamText({
      model: claudeCode('sonnet'),
      prompt: 'Count slowly from 1 to 20, explaining each number.',
      abortSignal: controller.signal,
    });

    console.log('   Streaming response: ');
    for await (const chunk of textStream) {
      process.stdout.write(chunk);
      charCount += chunk.length;

      // Cancel after receiving 100 characters
      if (charCount > 100) {
        console.log('\n   ⏱️  Cancelling stream after', charCount, 'characters...');
        controller.abort();
        break;
      }
    }
  } catch (error: any) {
    if (error.name === 'AbortError' || error.message?.includes('aborted')) {
      console.log('   ✅ Stream successfully cancelled');
    } else {
      console.error('   ❌ Error:', error.message);
    }
  }

  console.log('\n✅ AbortSignal examples completed');
  console.log('\nUse cases for AbortSignal:');
  console.log('- User-initiated cancellations (e.g., "Stop generating" button)');
  console.log('- Component unmount cleanup in React/Vue');
  console.log('- Request timeouts');
  console.log('- Rate limiting and request management');

  console.log('\nNote: This example suppresses ABORT_ERR uncaught exceptions');
  console.log('      which are expected when cancelling child processes.');

  // Exit cleanly
  process.exit(0);
}

main().catch(console.error);
