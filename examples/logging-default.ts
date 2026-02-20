/**
 * Default Logging Example
 *
 * Run: npx tsx examples/logging-default.ts
 *
 * This example demonstrates the default logging behavior of Claude Code.
 * By default, only warn and error messages are logged.
 * Debug and info messages are suppressed unless verbose mode is enabled.
 *
 * Expected output:
 * - No debug or info logs
 * - Only warn/error logs if something goes wrong
 * - Clean output focused on the actual response
 */

import { streamText } from 'ai';
import { claudeCode } from '../dist/index.js';

async function main() {
  console.log('=== Default Logging (Non-Verbose Mode) ===\n');
  console.log('Expected behavior:');
  console.log('- No debug or info logs');
  console.log('- Only warn/error logs appear if needed');
  console.log('- Clean output showing just the response\n');

  try {
    // Default logging - only warn/error messages will appear
    const result = streamText({
      model: claudeCode('opus'),
      prompt: 'Say hello in 5 words',
    });

    // Stream the response
    console.log('Response:');
    for await (const textPart of result.textStream) {
      process.stdout.write(textPart);
    }
    console.log('\n');

    // Get usage info
    const usage = await result.usage;
    console.log('Token usage:', usage);

    console.log('\n✓ Notice: No debug or info logs appeared above');
    console.log('  This is the default behavior - only essential output is shown');
  } catch (error) {
    console.error('Error:', error);
    console.log('\n💡 Troubleshooting:');
    console.log('1. Install Claude Code: https://docs.anthropic.com/en/docs/claude-code/overview');
    console.log('2. Authenticate: claude auth login');
    console.log('3. Run check-cli.ts to verify setup');
  }
}

main().catch(console.error);
