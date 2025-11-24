/**
 * Custom configuration example for Claude Code AI SDK Provider
 *
 * This example shows how to configure the provider and models
 * with specific settings for your use case.
 */

import { generateText } from 'ai';
import { createClaudeCode } from '../dist/index.js';
// NOTE: Migrating to Claude Agent SDK:
// - System prompt is not applied by default
// - Filesystem settings (CLAUDE.md, settings.json) are not loaded by default
// To restore old behavior, set:
//   systemPrompt: { type: 'preset', preset: 'claude_code' }
//   settingSources: ['user', 'project', 'local']

async function main() {
  console.log('🔧 Testing custom configurations...\n');

  try {
    // Example 1: Provider with default settings for all models
    const customProvider = createClaudeCode({
      defaultSettings: {
        // Skip permission prompts for all operations
        permissionMode: 'bypassPermissions',
        // Set working directory for file operations
        cwd: process.cwd(),
      },
    });

    console.log('1️⃣ Using provider with default settings:');
    const { text: response1 } = await generateText({
      model: customProvider('opus'), // Uses default settings
      prompt: 'What is the capital of France? Answer in one word.',
    });
    console.log('Response:', response1);

    // Example 2: Override settings for specific model instance
    console.log('\n2️⃣ Model with custom settings:');
    const { text: response2 } = await generateText({
      model: customProvider('opus', {
        // These settings override the provider defaults
        permissionMode: 'default', // Ask for permissions
        maxTurns: 5, // Limit conversation turns
      }),
      prompt: 'Name three popular programming languages. Just list them.',
    });
    console.log('Response:', response2);

    // Example 3: Using tool restrictions
    console.log('\n3️⃣ Model with tool restrictions:');
    const safeModel = customProvider('opus', {
      // Only allow read operations
      allowedTools: ['Read', 'LS', 'Grep', 'Glob'],
      // Explicitly block write operations
      disallowedTools: ['Write', 'Edit', 'Delete', 'Bash'],
    });

    const { text: response3 } = await generateText({
      model: safeModel,
      prompt: 'List the files in the current directory.',
    });
    console.log('Response:', response3);

    // Example 4: Multiple model instances from same provider
    console.log('\n4️⃣ Using multiple model instances:');
    const opusModel1 = customProvider('opus');
    const opusModel2 = customProvider('opus');

    // Quick comparison
    const prompt = 'Explain quantum computing in exactly 10 words.';

    const { text: response4a } = await generateText({
      model: opusModel1,
      prompt,
    });

    const { text: response4b } = await generateText({
      model: opusModel2,
      prompt,
    });

    console.log('Instance 1:', response4a);
    console.log('Instance 2:', response4b);
  } catch (error) {
    console.error('Error:', error);
  }
}

main().catch(console.error);
