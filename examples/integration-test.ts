/**
 * Integration tests for the Claude Code AI SDK Provider
 *
 * These tests verify core functionality of the provider
 * including text generation, conversations, and error handling.
 */

import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateText } from 'ai';
import {
  claudeCode,
  deleteSession,
  forkSession,
  getSessionInfo,
  isAuthenticationError,
} from '../dist/index.js';
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

async function testSessionLifecycle() {
  console.log('\n🧪 Test 6: Session lifecycle (create/resume/fork/inspect/delete)...');

  // Exercise the session helpers against real JSONL storage, but inside a
  // temporary CLAUDE_CONFIG_DIR so the test never touches ~/.claude/projects/.
  // The spawned CLI inherits CLAUDE_CONFIG_DIR from process.env, and the
  // in-process session helpers read it at call time.
  const realConfigDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  const tempConfigDir = await mkdtemp(join(tmpdir(), 'claude-it-sessions-'));
  // The global timeout exits via process.exit(1), which skips finally blocks;
  // register the dir for the synchronous exit handler so a copied
  // .credentials.json can never be left behind in /tmp.
  tempDirsToCleanUp.add(tempConfigDir);

  // A custom config dir has its own credential store, so keep the CLI
  // authenticated two ways (both best-effort, covering the common setups):
  // 1. Copy the credentials file when present (file-based auth, e.g. Linux).
  // 2. Set CLAUDE_SECURESTORAGE_CONFIG_DIR to '' so OS secure storage
  //    (e.g. the macOS Keychain) keeps using its default entry instead of a
  //    per-config-dir one. Env-var auth (ANTHROPIC_API_KEY /
  //    CLAUDE_CODE_OAUTH_TOKEN) is unaffected either way.
  try {
    await copyFile(
      join(realConfigDir, '.credentials.json'),
      join(tempConfigDir, '.credentials.json')
    );
  } catch {
    // No credentials file to copy — rely on secure-storage or env-based auth.
  }

  const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const previousSecureStorageDir = process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = tempConfigDir;
  process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = previousSecureStorageDir ?? '';

  try {
    // 1. Create a session.
    const first = await generateText({
      model: claudeCode('opus', { title: 'integration-test session' }),
      prompt: 'Remember this code word: "papaya". Reply with just OK.',
    });
    const sessionId = first.providerMetadata?.['claude-code']?.sessionId as string | undefined;
    if (!sessionId) {
      throw new Error('Session test failed - no session ID in providerMetadata');
    }
    console.log('✅ Created session:', sessionId);

    // 2. Resume it — context must carry over.
    const second = await generateText({
      model: claudeCode('opus', { resume: sessionId }),
      prompt: 'What was the code word? Reply with just the word.',
    });
    if (!second.text.toLowerCase().includes('papaya')) {
      throw new Error(`Session test failed - resume lost context: ${second.text}`);
    }
    console.log('✅ Resumed session with context intact');

    // 3. Fork the stored transcript without running a query.
    const fork = await forkSession(sessionId, { title: 'integration-test session (fork)' });
    if (!fork.sessionId || fork.sessionId === sessionId) {
      throw new Error('Session test failed - fork did not return a new session ID');
    }
    console.log('✅ Forked session:', fork.sessionId);

    // 4. Inspect both sessions.
    const originalInfo = await getSessionInfo(sessionId);
    const forkInfo = await getSessionInfo(fork.sessionId);
    if (!originalInfo || !forkInfo) {
      throw new Error('Session test failed - getSessionInfo did not find both sessions');
    }
    console.log('✅ Inspected sessions:', {
      original: originalInfo.customTitle ?? originalInfo.summary,
      fork: forkInfo.customTitle ?? forkInfo.summary,
    });

    // 5. Delete both; lookups should then come back empty.
    await deleteSession(fork.sessionId);
    await deleteSession(sessionId);
    if ((await getSessionInfo(sessionId)) !== undefined) {
      throw new Error('Session test failed - session still present after deleteSession');
    }
    console.log('✅ Sessions deleted');
  } finally {
    if (previousConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
    }
    if (previousSecureStorageDir === undefined) {
      delete process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = previousSecureStorageDir;
    }
    await rm(tempConfigDir, { recursive: true, force: true });
    tempDirsToCleanUp.delete(tempConfigDir);
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
    { name: 'Session Lifecycle', fn: testSessionLifecycle },
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

// Temp dirs that may hold copied credentials; cleaned both in finally blocks
// and synchronously at process exit (process.exit(1) skips finally).
const tempDirsToCleanUp = new Set<string>();
process.on('exit', () => {
  for (const dir of tempDirsToCleanUp) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort: nothing actionable at exit time
    }
  }
});

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
