/**
 * Verbose Logging Example
 *
 * Run: npx tsx examples/logging-verbose.ts
 *
 * This example demonstrates verbose logging mode.
 * When verbose: true is set, you'll see detailed debug and info logs
 * that help you understand what's happening under the hood.
 *
 * Expected output:
 * - Debug logs showing detailed execution trace
 * - Info logs about request/response flow
 * - Warn/error logs if issues occur
 * - Much more detailed output for troubleshooting
 *
 * Use verbose mode when:
 * - Debugging issues
 * - Understanding the provider's behavior
 * - Developing and testing
 */

import { streamText } from 'ai';
import { claudeCode } from '../dist/index.js';

async function main() {
  console.log('=== Verbose Logging Mode ===\n');
  console.log('Expected behavior:');
  console.log('- Debug logs showing internal details');
  console.log('- Info logs about execution flow');
  console.log('- Full visibility into what the provider is doing\n');

  try {
    // Enable verbose logging to see debug and info messages
    const result = streamText({
      model: claudeCode('opus', {
        verbose: true, // Enable verbose logging
      }),
      prompt: 'Say hello in 5 words',
    });

    // Stream the response
    console.log('\nResponse:');
    for await (const textPart of result.textStream) {
      process.stdout.write(textPart);
    }
    console.log('\n');

    // Get usage info
    const usage = await result.usage;
    console.log('Token usage:', usage);

    console.log('\n✓ Notice: Debug and info logs appeared above');
    console.log('  Verbose mode provides detailed execution information');
    console.log('  This is helpful for development and troubleshooting');
  } catch (error) {
    console.error('Error:', error);
    console.log('\n💡 Troubleshooting:');
    console.log('1. Install Claude Code: https://docs.anthropic.com/en/docs/claude-code/overview');
    console.log('2. Authenticate: claude auth login');
    console.log('3. Run check-cli.ts to verify setup');
  }
}

main().catch(console.error);
