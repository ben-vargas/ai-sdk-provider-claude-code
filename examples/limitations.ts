import { generateText, streamText } from 'ai';
import { generateObject } from 'ai';
import { claudeCode } from '../dist/index.js';
import { z } from 'zod';

/**
 * Example: Provider Limitations and Unsupported Features
 * 
 * This example explicitly demonstrates which AI SDK features are NOT supported
 * by the Claude Code provider due to CLI limitations. It shows what happens
 * when you try to use these features and suggests workarounds where possible.
 */

async function main() {
  console.log('🚧 Claude Code Provider Limitations\n');
  console.log('This example demonstrates features that are NOT supported by the Claude Code SDK.\n');

  // 1. Parameters that are silently ignored
  console.log('1. Parameters that are silently ignored:');
  console.log('   The following AI SDK parameters have no effect with Claude Code SDK:\n');
  
  try {
    const { text, usage } = await generateText({
      model: claudeCode('sonnet'),
      prompt: 'Write exactly 5 words.',
      // These parameters are part of the AI SDK spec but are ignored by Claude Code SDK
      temperature: 0.1,        // ❌ Ignored - CLI doesn't support temperature control
      maxOutputTokens: 10,    // ❌ Ignored - CLI doesn't support output length limits
      topP: 0.9,              // ❌ Ignored - CLI doesn't support nucleus sampling
      topK: 50,               // ❌ Ignored - CLI doesn't support top-k sampling
      presencePenalty: 0.5,   // ❌ Ignored - CLI doesn't support repetition penalties
      frequencyPenalty: 0.5,  // ❌ Ignored - CLI doesn't support repetition penalties
      stopSequences: ['END'], // ❌ Ignored - CLI doesn't support custom stop sequences
      seed: 12345,            // ❌ Ignored - CLI doesn't support deterministic output
    });

    console.log('   Result:', text);
    console.log('   Tokens used:', usage.totalTokens);
    console.log('\n   ⚠️  Note: Despite setting maxTokens:10, the response used', usage.totalTokens, 'tokens');
    console.log('   ⚠️  All the above parameters were silently ignored by the CLI\n');
  } catch (error) {
    console.error('   Error:', error);
  }

  // 2. Object generation - works via prompt engineering
  console.log('2. Object generation (works with limitations):');
  
  const PersonSchema = z.object({
    name: z.string(),
    age: z.number(),
    occupation: z.string(),
  });

  try {
    console.log('   Attempting generateObject()...');
    const { object } = await generateObject({
      model: claudeCode('sonnet'),
      schema: PersonSchema,
      prompt: 'Generate a person who is a software developer',
    });
    console.log('   ✅ Object generated:', object);
    console.log('   Note: Uses prompt engineering + JSON extraction');
    console.log('         Only object-json mode is supported (not object-tool)');
  } catch (error: any) {
    console.log('   ❌ Error:', error.message);
  }

  // 3. Tool/Function calling - not supported
  console.log('\n3. Tool/Function calling:');
  console.log('   ❌ Not supported - Claude Code SDK has no function calling capability');
  console.log('   ℹ️  While MCP servers can be configured, they cannot control output format\n');

  // 4. Image inputs - not supported
  console.log('4. Image inputs:');
  console.log('   ❌ Not supported - Claude Code SDK cannot process images');
  console.log('   ℹ️  The supportsImageUrls property is set to false\n');

  // 5. Streaming with unsupported parameters
  console.log('5. Streaming with ignored parameters:');
  try {
    const { textStream } = streamText({
      model: claudeCode('opus'),
      prompt: 'Count to 3',
      temperature: 0,  // ❌ Still ignored in streaming mode
      maxOutputTokens: 5,    // ❌ Still ignored in streaming mode
    });

    console.log('   Streaming: ');
    for await (const chunk of textStream) {
      process.stdout.write(chunk);
    }
    console.log('\n   ⚠️  Parameters were ignored in streaming mode too\n');
  } catch (error) {
    console.error('   Error:', error);
  }

  // 6. Workarounds and recommendations
  console.log('📝 Workarounds and Recommendations:\n');
  console.log('1. For temperature control:');
  console.log('   - Adjust your prompts to be more specific');
  console.log('   - Use phrases like "be creative" or "be precise"\n');
  
  console.log('2. For output length control:');
  console.log('   - Specify length in your prompt: "Write exactly 50 words"');
  console.log('   - Use explicit instructions: "Keep your response brief"\n');
  
  console.log('3. For structured output:');
  console.log('   - Use generateObject/streamObject (now supported!');
  console.log('   - Provider automatically handles JSON extraction');
  console.log('   - Only object-json mode is supported\n');
  
  console.log('4. For deterministic output:');
  console.log('   - Not possible with Claude Code SDK');
  console.log('   - Each request will produce different results\n');
  
  console.log('5. For function calling:');
  console.log('   - Implement your own prompt-based routing');
  console.log('   - Parse Claude\'s response to determine actions\n');

  console.log('🔍 Why these limitations exist:');
  console.log('- Claude Code SDK/CLI is mainly designed for interactive coding assistance');
  console.log('- It lacks the API\'s fine-grained control parameters');
  console.log('- The provider accurately reflects what the CLI can do\n');
  
  console.log('✅ What DOES work well:');
  console.log('- Basic text generation and streaming');
  console.log('- Object generation via generateObject/streamObject');
  console.log('- Conversation context via message history');
  console.log('- Custom timeouts and session management');
  console.log('- Abort signals for cancellation');
  console.log('- System messages for context setting');
}

main().catch(console.error);
// NOTE: Migrating to Claude Agent SDK:
// - System prompt is not applied by default
// - Filesystem settings (CLAUDE.md, settings.json) are not loaded by default
// To restore old behavior, set:
//   systemPrompt: { type: 'preset', preset: 'claude_code' }
//   settingSources: ['user', 'project', 'local']
