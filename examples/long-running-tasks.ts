#!/usr/bin/env tsx

/**
 * Example: Handling Long-Running Tasks
 *
 * Shows how to implement custom timeouts using AbortSignal
 * for complex tasks that may take longer than usual.
 */

import { generateText } from 'ai';
import { claudeCode } from '../dist/index.js';
// NOTE: Migrating to Claude Agent SDK:
// - System prompt is not applied by default
// - Filesystem settings (CLAUDE.md, settings.json) are not loaded by default
// To restore old behavior, set:
//   systemPrompt: { type: 'preset', preset: 'claude_code' }
//   settingSources: ['user', 'project', 'local']

async function withTimeout() {
  console.log('🕐 Example 1: Custom timeout for long task\n');

  // Create an AbortController with a 5-minute timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error('Request timeout after 5 minutes'));
  }, 300000); // 5 minutes

  try {
    const { text } = await generateText({
      model: claudeCode('opus'),
      prompt: 'Analyze the implications of quantum computing on cryptography...',
      abortSignal: controller.signal,
    });

    clearTimeout(timeoutId); // Clear timeout on success
    console.log('Response:', text);
  } catch (error: any) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError' || error.message?.includes('timeout')) {
      console.log('❌ Request timed out after 5 minutes');
      console.log('Consider breaking the task into smaller parts');
    } else {
      console.error('Error:', error);
    }
  }
}

async function withUserCancellation() {
  console.log('\n🛑 Example 2: User-cancellable request\n');

  const controller = new AbortController();

  // Simulate user cancellation after 2 seconds
  setTimeout(() => {
    console.log('User clicked cancel...');
    controller.abort(new Error('User cancelled the request'));
  }, 2000);

  try {
    console.log('Starting long task (will be cancelled in 2 seconds)...');

    const { text } = await generateText({
      model: claudeCode('opus'),
      prompt: 'Write a comprehensive guide to machine learning...',
      abortSignal: controller.signal,
    });

    console.log('Response:', text);
  } catch (error: any) {
    // Check for various abort/cancel error patterns
    const isAborted =
      error.name === 'AbortError' ||
      error.message?.includes('cancelled') ||
      error.message?.includes('aborted');

    if (isAborted) {
      console.log('✅ Request successfully cancelled by user');
    } else {
      console.error('Error:', error);
    }
  }
}

async function withGracefulTimeout() {
  console.log('\n⏰ Example 3: Graceful timeout with retry option\n');

  async function attemptWithTimeout(timeoutMs: number) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const { text } = await generateText({
        model: claudeCode('opus'),
        prompt: 'Explain the theory of relativity',
        abortSignal: controller.signal,
      });

      clearTimeout(timeoutId);
      return { success: true, text };
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        return { success: false, timeout: true };
      }
      throw error;
    }
  }

  // Try with 30-second timeout first
  console.log('Attempting with 30-second timeout...');
  let result = await attemptWithTimeout(30000);

  if (!result.success && result.timeout) {
    console.log('⏱️ First attempt timed out, trying with longer timeout...');

    // Retry with 2-minute timeout
    result = await attemptWithTimeout(120000);
  }

  if (result.success) {
    console.log('✅ Success!', result.text);
  } else {
    console.log('❌ Failed even with extended timeout');
  }
}

// Helper function for creating timeout controllers
function createTimeoutController(ms: number, reason = 'Request timeout'): AbortController {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`${reason} after ${ms}ms`));
  }, ms);

  // Add cleanup method
  (controller as any).clearTimeout = () => clearTimeout(timeoutId);

  return controller;
}

async function withHelper() {
  console.log('\n🔧 Example 4: Using timeout helper\n');

  const controller = createTimeoutController(60000, 'Complex analysis timeout');

  try {
    const { text } = await generateText({
      model: claudeCode('opus'),
      prompt: 'Analyze this code for security vulnerabilities...',
      abortSignal: controller.signal,
    });

    (controller as any).clearTimeout();
    console.log('Analysis complete:', text);
  } catch (error: any) {
    console.error('Analysis failed:', error.message);
  }
}

async function main() {
  console.log('=== Long-Running Task Examples ===\n');
  console.log('These examples show how to handle timeouts using AbortSignal');
  console.log('following Vercel AI SDK patterns.\n');

  await withTimeout();
  await withUserCancellation();
  await withGracefulTimeout();
  await withHelper();

  console.log('\n📝 Key Takeaways:');
  console.log('- Use AbortController for all cancellation needs');
  console.log('- Set custom timeouts based on task complexity');
  console.log('- Always clear timeouts on success');
  console.log('- Consider retry logic for timeout scenarios');
  console.log('- More complex tasks may need longer timeouts (5-10 minutes)');
}

main().catch(console.error);
