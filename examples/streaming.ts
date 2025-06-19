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