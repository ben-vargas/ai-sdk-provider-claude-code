import { streamText } from 'ai';
import { claudeCode } from '../dist/index.js';

async function main() {
  try {
    // Streaming response
    const result = streamText({
      model: claudeCode('sonnet'),
      prompt: 'Write a haiku about programming',
    });

    // Stream the response
    process.stdout.write('Streaming response: ');
    for await (const chunk of result.textStream) {
      process.stdout.write(chunk);
    }
    console.log('\n\nStreaming complete!');
  } catch (error) {
    console.error('Error:', error);
  }
}

main().catch(console.error);
// NOTE: Migrating to Claude Agent SDK:
// - System prompt is not applied by default
// - Filesystem settings (CLAUDE.md, settings.json) are not loaded by default
// To restore old behavior, set:
//   systemPrompt: { type: 'preset', preset: 'claude_code' }
//   settingSources: ['user', 'project', 'local']
