import { streamText } from 'ai';
import { claudeCode } from '../dist/index.js';

async function main() {
  try {
    console.log('Starting streaming example...\n');
    const startTime = Date.now();

    // Request a longer response to clearly demonstrate streaming
    const result = streamText({
      model: claudeCode('opus'),
      prompt: `Write a short story (about 300-400 words) about a programmer who discovers
their code has become sentient. Include dialogue and describe the programmer's emotions
as they realize what's happening.`,
    });

    // Stream the response with visual feedback
    let chunkCount = 0;
    let totalChars = 0;
    let firstChunkTime: number | null = null;

    console.log('--- Response ---\n');

    for await (const chunk of result.textStream) {
      if (firstChunkTime === null) {
        firstChunkTime = Date.now();
        console.log(`[First chunk received after ${firstChunkTime - startTime}ms]\n`);
      }
      process.stdout.write(chunk);
      chunkCount++;
      totalChars += chunk.length;
    }

    const endTime = Date.now();
    console.log('\n\n--- Statistics ---');
    console.log(`Total chunks received: ${chunkCount}`);
    console.log(`Total characters: ${totalChars}`);
    console.log(`Time to first chunk: ${firstChunkTime ? firstChunkTime - startTime : 0}ms`);
    console.log(`Total time: ${endTime - startTime}ms`);
    console.log(`Average chunk size: ${(totalChars / chunkCount).toFixed(1)} chars`);
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
