import { generateText, streamText } from 'ai';
import { generateObject } from 'ai';
import { claudeCode } from '../dist/index.js';
import { z } from 'zod';

/**
 * Example: Provider Limitations and Unsupported Features
 *
 * This example demonstrates which AI SDK features are NOT supported (or only
 * partially supported) by the Claude Code provider due to CLI limitations. It
 * shows what happens when you try to use these features and suggests
 * workarounds where possible.
 */

async function main() {
  console.log('🚧 Claude Code Provider Limitations\n');
  console.log(
    'This example demonstrates features that are NOT supported, or only partially supported, by the Claude Code SDK.\n'
  );

  // 1. Parameters that are ignored
  console.log('1. Parameters that are ignored:');
  console.log('   The following AI SDK parameters have no effect with Claude Code SDK');
  console.log('   (the provider emits an AI SDK warning for each one):\n');

  try {
    const { text, usage } = await generateText({
      model: claudeCode('opus'),
      prompt: 'Write two sentences about the ocean.',
      // These parameters are part of the AI SDK spec but are ignored by Claude Code SDK
      temperature: 0.1, // ❌ Ignored - CLI doesn't support temperature control
      maxOutputTokens: 10, // ❌ Ignored - CLI doesn't support output length limits
      topP: 0.9, // ❌ Ignored - CLI doesn't support nucleus sampling
      topK: 50, // ❌ Ignored - CLI doesn't support top-k sampling
      presencePenalty: 0.5, // ❌ Ignored - CLI doesn't support repetition penalties
      frequencyPenalty: 0.5, // ❌ Ignored - CLI doesn't support repetition penalties
      stopSequences: ['END'], // ❌ Ignored - CLI doesn't support custom stop sequences
      seed: 12345, // ❌ Ignored - CLI doesn't support deterministic output
    });

    console.log('   Result:', text);
    // totalTokens also counts input and prompt-cache tokens (Claude Code's
    // system prompt and tools), so report output tokens separately.
    console.log('   Output tokens:', usage.outputTokens);
    console.log('   Total tokens (input + cache + output):', usage.totalTokens);
    console.log(
      '\n   ⚠️  Note: maxOutputTokens: 10 did not cap the response; it used',
      usage.outputTokens,
      'output tokens'
    );
    console.log('   ⚠️  All the above parameters were ignored (see the AI SDK warnings)\n');
  } catch (error) {
    console.error('   Error:', error);
  }

  // 2. Object generation - native SDK support with caveats
  console.log('2. Object generation (supported with native SDK, with caveats):');

  const PersonSchema = z.object({
    name: z.string(),
    age: z.number(),
    occupation: z.string(),
  });

  try {
    console.log('   Attempting generateObject()...');
    const { object } = await generateObject({
      model: claudeCode('opus'),
      schema: PersonSchema,
      prompt: 'Generate a person who is a software developer',
    });
    console.log('   ✅ Object generated:', object);
    console.log('   Note: Uses native SDK constrained decoding (outputFormat)');
    console.log('         Schema compliance for supported JSON Schema features');
    console.log('         The provider strips `format` keywords (email, uri, ...) and Zod');
    console.log('         re-validates them client-side. Older CLI releases fell back to');
    console.log('         prose for `format` and lookahead patterns; current CLIs return');
    console.log('         structured output. examples/structured-output-repro.ts checks this.');
  } catch (error: any) {
    console.log('   ❌ Error:', error.message);
  }

  // 3. Tool/Function calling - supported via Claude Code, not via the `tools` option
  console.log('\n3. Tool/Function calling:');
  console.log('   ✅ Claude Code runs its built-in tools (Bash, Read, ...) provider-side;');
  console.log('      tool calls and results stream as provider-executed tool parts');
  console.log('      (see tool-streaming.ts)');
  console.log('   ✅ Your own AI SDK tools work when bridged with createAiSdkMcpServer');
  console.log('      (see ai-sdk-tools.ts)');
  console.log('   ⚠️  The generateText/streamText `tools` option is not forwarded to the CLI;');
  console.log('      the provider warns and ignores it\n');

  // 4. Image inputs - supported; the CLI itself needs inline image data
  console.log('4. Image inputs:');
  console.log("   ✅ Supported when streaming input is enabled, e.g. streamingInput: 'always'");
  console.log('      (data URLs or base64 image parts; see images.ts)');
  console.log('   ℹ️  The CLI only accepts inline image data (supportsImageUrls is false), so');
  console.log('      for http(s) image URLs the AI SDK downloads the image first and the');
  console.log('      provider forwards the bytes\n');

  // 5. Streaming with unsupported parameters
  console.log('5. Streaming with ignored parameters:');
  try {
    const { textStream } = streamText({
      model: claudeCode('opus'),
      prompt: 'Count from 1 to 20, separated by commas.',
      temperature: 0, // ❌ Still ignored in streaming mode
      maxOutputTokens: 5, // ❌ Still ignored in streaming mode
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
  console.log('   - ✅ Supported via native SDK constrained decoding (outputFormat)');
  console.log('   - Use generateObject/streamObject with Zod schemas');
  console.log('   - Prefer a simplified generation schema, then validate client-side');
  console.log('   - Run structured-output-repro.ts to check your CLI for schema regressions\n');

  console.log('4. For deterministic output:');
  console.log('   - Not possible with Claude Code SDK');
  console.log('   - Each request will produce different results\n');

  console.log('5. For function calling with your own tools:');
  console.log('   - Bridge AI SDK tools with createAiSdkMcpServer (see ai-sdk-tools.ts)');
  console.log('   - Or expose them through an MCP server via the mcpServers setting\n');

  console.log('🔍 Why these limitations exist:');
  console.log('- Claude Code SDK/CLI is mainly designed for interactive coding assistance');
  console.log("- It lacks the API's fine-grained control parameters");
  console.log('- The provider accurately reflects what the CLI can do\n');

  console.log('✅ What DOES work well:');
  console.log('- Basic text generation and streaming');
  console.log('- Native structured outputs for supported schema features');
  console.log('- Claude Code built-in tools and bridged AI SDK/MCP tools');
  console.log('- Image inputs (inline data, or URLs downloaded by the AI SDK)');
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
