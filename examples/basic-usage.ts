/**
 * Basic usage example for Claude Code AI SDK Provider
 * 
 * This example demonstrates simple text generation with the provider
 * and shows the metadata returned from each request.
 */

import { streamText } from 'ai';
import { claudeCode } from '../dist/index.js';

async function main() {
  try {
    // Basic text generation - streamText returns immediately, not a promise
    const result = streamText({
      model: claudeCode('opus'),
      prompt: 'Explain the concept of recursion in programming in 2-3 sentences.',
    });

    // Stream the response
    console.log('Response:');
    for await (const textPart of result.textStream) {
      process.stdout.write(textPart);
    }
    console.log('\n');

    // Get final results
    const usage = await result.usage;
    const providerMetadata = await result.providerMetadata;

    console.log('\nToken usage:', usage);
    
    // Display provider-specific metadata
    const metadata = providerMetadata?.['claude-code'];
    if (metadata) {
      console.log('\nProvider metadata:');
      
      // Session ID is assigned by the SDK for internal tracking
      if (metadata.sessionId) {
        console.log(`- Session ID: ${metadata.sessionId}`);
      }
      
      // Performance metrics
      if (metadata.durationMs) {
        console.log(`- Duration: ${metadata.durationMs}ms`);
      }
      
      // Cost information
      if (typeof metadata.costUsd === 'number') {
        console.log(`- Cost: ${metadata.costUsd.toFixed(4)}`);
        console.log('  (Pro/Max subscribers: covered by subscription)');
      }
      
      // Raw usage breakdown if available
      if (metadata.rawUsage) {
        console.log('- Detailed usage:', JSON.stringify(metadata.rawUsage, null, 2));
      }
    }
  } catch (error) {
    console.error('Error:', error);
    console.log('\n💡 Troubleshooting:');
    console.log('1. Install Claude Code SDK: npm install -g @anthropic-ai/claude-code');
    console.log('2. Authenticate: claude login');
    console.log('3. Run check-cli.ts to verify setup');
  }
}


main().catch(console.error);
// NOTE: Migrating to Claude Agent SDK:
// - System prompt is not applied by default
// - Filesystem settings (CLAUDE.md, settings.json) are not loaded by default
// To restore old behavior, set:
//   systemPrompt: { type: 'preset', preset: 'claude_code' }
//   settingSources: ['user', 'project', 'local']
