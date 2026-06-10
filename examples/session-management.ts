/**
 * Example: Session Management
 *
 * Demonstrates the full session lifecycle:
 * 1. Create a session with generateText (capture the session ID from providerMetadata)
 * 2. Resume the session (context carries over)
 * 3. Fork the stored transcript with forkSession() — no query needed
 * 4. Inspect both sessions with getSessionInfo()
 * 5. Clean up with deleteSession()
 *
 * Sessions are persisted as JSONL transcripts under ~/.claude/projects/
 * (honoring CLAUDE_CONFIG_DIR). The helper functions are re-exported from
 * the Claude Agent SDK and operate on that storage directly. This example
 * runs against your real session storage and deletes everything it creates;
 * the integration suite (`npm run test:integration`) exercises the same
 * lifecycle in a temporary CLAUDE_CONFIG_DIR instead.
 *
 * See docs/sessions.md for the full guide.
 */

import { generateText } from 'ai';
import { claudeCode, forkSession, getSessionInfo, deleteSession } from '../dist/index.js';

async function main() {
  console.log('🗂️  Session Management Example\n');

  // ============================================
  // 1. Create a session
  // ============================================
  console.log('1️⃣  Creating a session...');
  const first = await generateText({
    model: claudeCode('sonnet', { title: 'session-management example' }),
    prompt: 'Remember this code word: "papaya". Reply with just OK.',
  });
  console.log('Assistant:', first.text);

  const sessionId = first.providerMetadata?.['claude-code']?.sessionId as string | undefined;
  if (!sessionId) {
    throw new Error('No session ID in providerMetadata — cannot continue.');
  }
  console.log('Session ID:', sessionId);

  // ============================================
  // 2. Resume the session
  // ============================================
  console.log('\n2️⃣  Resuming the session...');
  const second = await generateText({
    model: claudeCode('sonnet', { resume: sessionId }),
    prompt: 'What was the code word? Reply with just the word.',
  });
  console.log('Assistant:', second.text);
  const contextMaintained = second.text.toLowerCase().includes('papaya');
  console.log('✅ Context maintained via resume:', contextMaintained);

  // ============================================
  // 3. Fork the session with forkSession()
  // ============================================
  // Unlike the `forkSession: true` setting (which forks while running a
  // query), the forkSession() helper copies the stored transcript into a
  // new session ID without running anything.
  console.log('\n3️⃣  Forking the session with forkSession()...');
  const fork = await forkSession(sessionId, {
    title: 'session-management example (fork)',
  });
  console.log('Fork session ID:', fork.sessionId);

  // The fork is resumable like any other session and has the same context.
  const fromFork = await generateText({
    model: claudeCode('sonnet', { resume: fork.sessionId }),
    prompt: 'Same question in this fork: what was the code word?',
  });
  console.log('Assistant (fork):', fromFork.text);

  // ============================================
  // 4. Inspect both sessions with getSessionInfo()
  // ============================================
  console.log('\n4️⃣  Inspecting sessions with getSessionInfo()...');
  const originalInfo = await getSessionInfo(sessionId);
  const forkInfo = await getSessionInfo(fork.sessionId);
  console.log('Original:', {
    summary: originalInfo?.summary,
    customTitle: originalInfo?.customTitle,
    lastModified: originalInfo?.lastModified && new Date(originalInfo.lastModified).toISOString(),
  });
  console.log('Fork:    ', {
    summary: forkInfo?.summary,
    customTitle: forkInfo?.customTitle,
    lastModified: forkInfo?.lastModified && new Date(forkInfo.lastModified).toISOString(),
  });

  // ============================================
  // 5. Clean up with deleteSession()
  // ============================================
  console.log('\n5️⃣  Cleaning up with deleteSession()...');
  await deleteSession(fork.sessionId);
  await deleteSession(sessionId);

  const afterDelete = await getSessionInfo(sessionId);
  console.log('✅ Sessions deleted (lookup now returns):', afterDelete);
}

main()
  .then(() => {
    console.log('\n✅ Session management example completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Example failed:', error);
    process.exit(1);
  });
