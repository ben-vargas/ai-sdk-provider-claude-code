/**
 * Integration tests for the Claude Code AI SDK Provider
 *
 * These tests verify core functionality of the provider
 * including text generation, conversations, and error handling.
 */

import { generateText } from 'ai';
import { claudeCode, isAuthenticationError } from '../dist/index.js';
// NOTE: Migrating to Claude Agent SDK:
// - System prompt is not applied by default
// - Filesystem settings (CLAUDE.md, settings.json) are not loaded by default
// To restore old behavior, set:
//   systemPrompt: { type: 'preset', preset: 'claude_code' }
//   settingSources: ['user', 'project', 'local']

async function testBasicGeneration() {
  console.log('🧪 Test 1: Basic text generation with Haiku...');
  try {
    const { text } = await generateText({
      model: claudeCode('opus'),
      prompt: 'Say "Hello from Claude Code Provider!" and nothing else.',
    });

    if (text.includes('Hello from Claude Code Provider')) {
      console.log('✅ Success:', text);
    } else {
      console.error('❌ Unexpected response:', text);
      throw new Error('Basic generation test failed');
    }
  } catch (error) {
    console.error('❌ Failed:', error);
    throw error;
  }
}

async function testWithSystemMessage() {
  console.log('\n🧪 Test 2: Generation with system message...');
  try {
    const { text } = await generateText({
      model: claudeCode('opus'),
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant. Answer with just the number, no explanation.',
        },
        { role: 'user', content: 'What is 2+2?' },
      ],
    });

    const cleanText = text.trim();
    if (cleanText === '4' || cleanText.includes('4')) {
      console.log('✅ Success:', text);
    } else {
      console.error('❌ Unexpected response:', text);
      throw new Error('System message test failed');
    }
  } catch (error) {
    console.error('❌ Failed:', error);
    throw error;
  }
}

async function testConversation() {
  console.log('\n🧪 Test 3: Multi-turn conversation with message history...');
  try {
    // First turn: establish context
    const { text: response1 } = await generateText({
      model: claudeCode('opus'),
      messages: [
        {
          role: 'user',
          content:
            'My favorite color is purple and I live in Seattle. Just acknowledge this information.',
        },
      ],
    });
    console.log('✅ First turn:', response1);

    // Second turn: test memory with full history
    const { text: response2 } = await generateText({
      model: claudeCode('opus'),
      messages: [
        {
          role: 'user',
          content:
            'My favorite color is purple and I live in Seattle. Just acknowledge this information.',
        },
        { role: 'assistant', content: response1 },
        { role: 'user', content: 'What is my favorite color?' },
      ],
    });

    if (response2.toLowerCase().includes('purple')) {
      console.log('✅ Second turn (remembered color):', response2);
    } else {
      console.error('❌ Failed to remember color:', response2);
      throw new Error('Conversation memory test failed');
    }

    // Third turn: test deeper context
    const { text: response3 } = await generateText({
      model: claudeCode('opus'),
      messages: [
        {
          role: 'user',
          content:
            'My favorite color is purple and I live in Seattle. Just acknowledge this information.',
        },
        { role: 'assistant', content: response1 },
        { role: 'user', content: 'What is my favorite color?' },
        { role: 'assistant', content: response2 },
        { role: 'user', content: 'Where do I live?' },
      ],
    });

    if (response3.toLowerCase().includes('seattle')) {
      console.log('✅ Third turn (remembered location):', response3);
      console.log('✅ Conversation context maintained successfully!');
    } else {
      console.error('❌ Failed to remember location:', response3);
      throw new Error('Conversation memory test failed');
    }
  } catch (error) {
    console.error('❌ Failed:', error);
    throw error;
  }
}

async function testErrorHandling() {
  console.log('\n🧪 Test 4: Error handling with invalid executable path...');
  try {
    const badClaude = claudeCode('opus', {
      pathToClaudeCodeExecutable: 'claude-nonexistent-binary-12345',
    });

    await generateText({
      model: badClaude,
      prompt: 'This should fail',
    });

    console.error('❌ Expected error but got success');
    throw new Error('Error handling test failed - should have thrown an error');
  } catch (error: any) {
    if (error.message?.includes('not found') || error.message?.includes('ENOENT')) {
      console.log('✅ Error handled correctly:', error.message);
    } else if (error.message?.includes('Error handling test failed')) {
      throw error; // Re-throw our test failure
    } else {
      console.log('✅ Got error (different than expected):', error.message);
    }
  }
}

async function testStreaming() {
  console.log('\n🧪 Test 5: Basic streaming...');
  try {
    const { textStream } = streamText({
      model: claudeCode('opus'),
      prompt: 'Count from 1 to 5, one number per line.',
    });

    let fullText = '';
    process.stdout.write('Streaming: ');
    for await (const chunk of textStream) {
      process.stdout.write(chunk);
      fullText += chunk;
    }
    console.log('\n✅ Streaming completed');

    // Verify we got numbers
    const hasNumbers = ['1', '2', '3', '4', '5'].every((num) => fullText.includes(num));
    if (!hasNumbers) {
      throw new Error('Streaming test failed - missing expected numbers');
    }
  } catch (error) {
    console.error('\n❌ Streaming failed:', error);
    throw error;
  }
}

// Import streamText for the streaming test
import { streamText } from 'ai';

async function runAllTests() {
  console.log('🚀 Running Claude Code AI SDK Provider Integration Tests\n');

  const startTime = Date.now();
  let testsRun = 0;
  let testsPassed = 0;

  const tests = [
    { name: 'Basic Generation', fn: testBasicGeneration },
    { name: 'System Message', fn: testWithSystemMessage },
    { name: 'Conversation', fn: testConversation },
    { name: 'Error Handling', fn: testErrorHandling },
    { name: 'Streaming', fn: testStreaming },
  ];

  for (const test of tests) {
    testsRun++;
    try {
      await test.fn();
      testsPassed++;
    } catch (error) {
      console.error(`\n❌ ${test.name} test failed`);
      if (isAuthenticationError(error)) {
        console.log('\n⚠️  Authentication required. Please run: claude auth login');
        process.exit(1);
      }
    }
  }

  const duration = Date.now() - startTime;
  console.log('\n' + '='.repeat(50));
  console.log(`📊 Test Results: ${testsPassed}/${testsRun} passed (${duration}ms)`);

  if (testsPassed === testsRun) {
    console.log('✅ All tests passed!');
    process.exit(0);
  } else {
    console.log(`❌ ${testsRun - testsPassed} tests failed`);
    process.exit(1);
  }
}

// Add configurable global timeout (default 3 minutes)
const TIMEOUT_MS = Number(process.env.CLAUDE_IT_TIMEOUT_MS ?? '180000');
const timeoutId = setTimeout(() => {
  console.log(`\n⏱️ Tests timed out after ${TIMEOUT_MS / 1000} seconds`);
  process.exit(1);
}, TIMEOUT_MS);

runAllTests()
  .then(() => {
    clearTimeout(timeoutId);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
