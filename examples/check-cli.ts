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
      model: claudeCode('haiku'),
      prompt: 'Say "Hello from Claude" and nothing else.',
    });

    console.log('✅ Claude Code SDK is working properly!');
    console.log('Response:', text);
    console.log('Tokens used:', usage.totalTokens);
    console.log('\n🎉 You can run all the examples and integration tests!');
  } catch (error: any) {
    console.error('❌ Failed to connect to Claude Code');
    console.error('Error:', error.message);

    if (error.message?.includes('not found') || error.message?.includes('ENOENT')) {
      console.log('\n💡 Make sure Claude Code SDK is installed:');
      console.log('   npm install -g @anthropic-ai/claude-code');
    } else if (error.message?.includes('authentication') || error.message?.includes('401')) {
      console.log('\n🔐 Authentication required. Please run:');
      console.log('   claude login');
    } else {
      console.log('\n🔧 Troubleshooting tips:');
      console.log('1. Install Claude Code SDK: npm install -g @anthropic-ai/claude-code');
      console.log('2. Authenticate: claude login');
      console.log('3. Verify installation: claude --version');
    }

    process.exit(1);
  }
}

checkSetup().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
