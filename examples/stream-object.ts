#!/usr/bin/env tsx

/**
 * Example: Streaming Object Generation with Partial Updates
 *
 * Demonstrates using streamObject() to receive incremental partial objects
 * as the AI generates structured data. This enables real-time UI updates
 * as each field becomes available.
 */

import { createClaudeCode } from '../dist/index.js';
import { streamObject } from 'ai';
import { z } from 'zod';

const claudeCode = createClaudeCode();

// Define a schema for the structured output
const profileSchema = z.object({
  name: z.string().describe('Name of the person'),
  age: z.number().describe('Age in years'),
  occupation: z.string().describe('Job title'),
  hobbies: z.array(z.string()).describe('List of hobbies'),
  bio: z.string().describe('A short biography (2-3 sentences)'),
});

async function main() {
  console.log('=== Stream Object Example ===\n');
  console.log('Generating a developer profile with real-time partial updates...\n');

  const startTime = Date.now();
  let firstPartialTime: number | null = null;
  let partialCount = 0;

  const { partialObjectStream, object } = streamObject({
    model: claudeCode('sonnet'),
    schema: profileSchema,
    prompt:
      'Generate a fictional software developer profile with creative hobbies and an interesting bio.',
  });

  console.log('--- Streaming Progress ---\n');

  for await (const partial of partialObjectStream) {
    partialCount++;

    if (!firstPartialTime) {
      firstPartialTime = Date.now();
      console.log(`[First partial received after ${firstPartialTime - startTime}ms]\n`);
    }

    // Show field completion progress
    const hasName = 'name' in partial && partial.name;
    const hasAge = 'age' in partial && partial.age !== undefined;
    const hasOccupation = 'occupation' in partial && partial.occupation;
    const hobbiesCount =
      'hobbies' in partial && Array.isArray(partial.hobbies) ? partial.hobbies.length : 0;
    const hasBio = 'bio' in partial && partial.bio;

    // Log select updates to show streaming progress
    if (partialCount <= 5 || partialCount % 25 === 0) {
      console.log(
        `  Partial #${partialCount}: name=${hasName ? '✓' : '...'} age=${hasAge ? '✓' : '...'} occupation=${hasOccupation ? '✓' : '...'} hobbies=${hobbiesCount} bio=${hasBio ? '✓' : '...'}`
      );
    }
  }

  // Get the final validated object
  const finalObject = await object;
  const endTime = Date.now();

  console.log('\n--- Final Object ---\n');
  console.log(JSON.stringify(finalObject, null, 2));

  console.log('\n--- Statistics ---');
  console.log(`Total partial updates: ${partialCount}`);
  console.log(`Time to first partial: ${firstPartialTime ? firstPartialTime - startTime : 0}ms`);
  console.log(`Total time: ${endTime - startTime}ms`);
}

main().catch(console.error);
