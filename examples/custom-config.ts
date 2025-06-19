/**
 * Custom configuration example for Claude Code AI SDK Provider
 * 
 * This example shows how to configure the provider and models
 * with specific settings for your use case.
 */

import { generateText } from 'ai';
import { createClaudeCode } from '../dist/index.js';

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
      }
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
      model: customProvider('sonnet', { 
        // These settings override the provider defaults
        permissionMode: 'default', // Ask for permissions
        maxTurns: 5, // Limit conversation turns
      }),
      prompt: 'Name three popular programming languages. Just list them.',
    });
    console.log('Response:', response2);

    // Example 3: Using tool restrictions
    console.log('\n3️⃣ Model with tool restrictions:');
    const safeModel = customProvider('sonnet', {
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

    // Example 4: Different models from same provider
    console.log('\n4️⃣ Using different models:');
    const opusModel = customProvider('opus');
    const sonnetModel = customProvider('sonnet');
    
    // Quick comparison
    const prompt = 'Explain quantum computing in exactly 10 words.';
    
    const { text: opusResponse } = await generateText({
      model: opusModel,
      prompt,
    });
    
    const { text: sonnetResponse } = await generateText({
      model: sonnetModel,
      prompt,
    });
    
    console.log('Opus:', opusResponse);
    console.log('Sonnet:', sonnetResponse);

  } catch (error) {
    console.error('Error:', error);
  }
}

main();