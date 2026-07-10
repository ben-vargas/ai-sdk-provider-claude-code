/**
 * Check if the Claude Code SDK is properly installed and authenticated
 * This example verifies the setup before running other examples
 */

import { generateText } from 'ai';
import { createClaudeCode } from '../dist/index.js';

async function checkSetup() {
  console.log('🔍 Checking Claude Code SDK setup...\n');

  const claudeCode = createClaudeCode();

  try {
    // Try a simple generation to verify everything works
    console.log('Testing SDK connection...');

    const { text, usage } = await generateText({
      model: claudeCode('opus'),
      prompt: 'Say "Hello from Claude" and nothing else.',
    });

    console.log('✅ Claude Code SDK is working properly!');
    console.log('Response:', text);
    console.log('Tokens used:', usage.totalTokens);
    console.log('\n🎉 You can run all the examples and integration tests!');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    console.error('❌ Failed to connect to Claude Code');
    console.error('Error:', message);

    if (message.includes('not found') || message.includes('ENOENT')) {
      console.log('\n💡 Make sure Claude Code is installed:');
      console.log('   https://docs.anthropic.com/en/docs/claude-code/overview');
    } else if (message.includes('authentication') || message.includes('401')) {
      console.log('   claude auth login');
    } else {
      console.log('\n🔧 Troubleshooting tips:');
      console.log(
        '1. Install Claude Code: https://docs.anthropic.com/en/docs/claude-code/overview'
      );
      console.log('2. Authenticate: claude auth login');
      console.log('3. Verify installation: claude --version');
    }

    process.exit(1);
  }
}

checkSetup().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
