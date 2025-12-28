/**
 * Test conversation management with proper message history
 */

import { generateText } from 'ai';
import { claudeCode } from '../dist/index.js';
// NOTE: Migrating to Claude Agent SDK:
// - System prompt is not applied by default
// - Filesystem settings (CLAUDE.md, settings.json) are not loaded by default
// To restore old behavior, set:
//   systemPrompt: { type: 'preset', preset: 'claude_code' }
//   settingSources: ['user', 'project', 'local']
import type { ModelMessage } from 'ai';

async function testConversation() {
  console.log('🧪 Testing conversation with message history...');

  const model = claudeCode('opus');
  const messages: ModelMessage[] = [];

  // First turn
  console.log(`\n1️⃣ First turn...`);
  messages.push({
    role: 'user' as const,
    content: "My name is Helen and I'm a data scientist. Remember this.",
  });

  const response1 = await generateText({
    model,
    messages,
  });
  console.log('Assistant:', response1.text);
  messages.push({ role: 'assistant' as const, content: response1.text });

  // Second turn - add to conversation
  console.log(`\n2️⃣ Second turn...`);
  messages.push({ role: 'user' as const, content: "What's my profession?" });

  const response2 = await generateText({
    model,
    messages,
  });
  console.log('Assistant:', response2.text);

  // Third turn - test memory
  console.log(`\n3️⃣ Third turn...`);
  messages.push({ role: 'assistant' as const, content: response2.text });
  messages.push({ role: 'user' as const, content: 'And what was my name again?' });

  const response3 = await generateText({
    model,
    messages,
  });
  console.log('Assistant:', response3.text);

  // Check if context was maintained through message history
  const contextMaintained = response3.text.toLowerCase().includes('helen');
  console.log(`\n✅ Context maintained via message history:`, contextMaintained);
}

testConversation()
  .then(() => {
    console.log(`\n✅ Test completed`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(`\n❌ Test failed:`, error);
    process.exit(1);
  });
