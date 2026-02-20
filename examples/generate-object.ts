#!/usr/bin/env tsx

/**
 * Object Generation Examples
 *
 * Demonstrates core generateObject patterns with the Claude Code provider,
 * progressing from simple to complex.
 *
 * Topics covered:
 * - Simple objects with primitives
 * - Arrays and optional fields
 * - Enums and nested objects
 * - Arrays of objects
 * - Deep nesting (3+ levels)
 *
 * NOTE: Avoid Zod methods that produce unsupported JSON Schema annotations:
 * .email(), .url(), .uuid(), .datetime() all emit `format` constraints that
 * cause the Claude Code CLI to silently fall back to prose. Use .describe()
 * with format hints instead, then validate client-side if strict format
 * compliance is needed. See JSON_FIX.md for details.
 */

import { createClaudeCode } from '../dist/index.js';
import { generateObject } from 'ai';
import { z } from 'zod';

const claudeCode = createClaudeCode();

console.log('=== Claude Code: Object Generation Examples ===\n');

// ---------------------------------------------------------------------------
// Example 1: Simple object with primitives
// ---------------------------------------------------------------------------
async function example1_simpleObject() {
  console.log('1. Simple Object with Primitives\n');

  const { object } = await generateObject({
    model: claudeCode('opus'),
    schema: z.object({
      name: z.string().describe('Full name of the person'),
      age: z.number().describe('Age in years'),
      email: z.string().describe('Email address (e.g. user@example.com)'),
      isActive: z.boolean().describe('Whether the account is active'),
    }),
    prompt: 'Generate a profile for a software developer named Sarah.',
  });

  console.log('Generated profile:');
  console.log(JSON.stringify(object, null, 2));
  console.log();
}

// ---------------------------------------------------------------------------
// Example 2: Arrays and optional fields
// ---------------------------------------------------------------------------
async function example2_arraysAndOptional() {
  console.log('2. Arrays and Optional Fields\n');

  const { object } = await generateObject({
    model: claudeCode('opus'),
    schema: z.object({
      productName: z.string().describe('Name of the product'),
      price: z.number().describe('Price in USD'),
      description: z.string().describe('Product description'),
      discount: z.number().optional().describe('Discount percentage if applicable'),
      tags: z.array(z.string()).optional().describe('Product tags for categorization'),
      features: z.array(z.string()).describe('Key product features'),
      inStock: z.boolean().describe('Whether the product is in stock'),
    }),
    prompt: 'Generate a product listing for a wireless mechanical keyboard.',
  });

  console.log('Generated product:');
  console.log(JSON.stringify(object, null, 2));
  console.log();
}

// ---------------------------------------------------------------------------
// Example 3: Enums and nested objects
// ---------------------------------------------------------------------------
async function example3_enumsAndNested() {
  console.log('3. Enums and Nested Objects\n');

  const { object } = await generateObject({
    model: claudeCode('opus'),
    schema: z.object({
      id: z.string().describe('Unique user ID'),
      username: z.string(),
      profile: z.object({
        firstName: z.string(),
        lastName: z.string(),
        age: z.number().min(0).max(150),
        email: z.string().describe('Email address (e.g. alex@example.com)'),
        bio: z.string().describe('Short biography'),
        interests: z.array(z.string()).describe('List of interests'),
        location: z.object({
          city: z.string(),
          country: z.string(),
          timezone: z.string(),
        }),
      }),
      settings: z.object({
        theme: z.enum(['light', 'dark', 'auto']),
        notifications: z.boolean(),
        language: z.string(),
      }),
    }),
    prompt:
      'Generate a complete user profile for a software developer named Alex who loves open source.',
  });

  console.log('Generated user profile:');
  console.log(JSON.stringify(object, null, 2));
  console.log();
}

// ---------------------------------------------------------------------------
// Example 4: Arrays of objects
// ---------------------------------------------------------------------------
async function example4_arraysOfObjects() {
  console.log('4. Arrays of Objects\n');

  const { object } = await generateObject({
    model: claudeCode('opus'),
    schema: z.object({
      name: z.string().describe('Name of the recipe'),
      ingredients: z
        .array(
          z.object({
            item: z.string(),
            amount: z.string(),
          })
        )
        .describe('List of ingredients with amounts'),
      instructions: z.array(z.string()).describe('Step-by-step cooking instructions'),
      prepTime: z.number().describe('Preparation time in minutes'),
      cookTime: z.number().describe('Cooking time in minutes'),
      servings: z.number().describe('Number of servings'),
    }),
    prompt: 'Generate a detailed recipe for chocolate chip cookies.',
  });

  console.log('Generated recipe:');
  console.log(JSON.stringify(object, null, 2));
  console.log();
}

// ---------------------------------------------------------------------------
// Example 5: Deep nesting (3+ levels)
// ---------------------------------------------------------------------------
async function example5_deepNesting() {
  console.log('5. Deep Nesting (3+ Levels)\n');

  const { object } = await generateObject({
    model: claudeCode('opus'),
    schema: z.object({
      company: z.object({
        name: z.string().describe('Company name'),
        founded: z.number().describe('Year founded'),
        headquarters: z.object({
          city: z.string(),
          country: z.string(),
          timezone: z.string(),
        }),
        departments: z
          .array(
            z.object({
              name: z.string().describe('Department name'),
              budget: z.number().describe('Annual budget in USD'),
              headCount: z.number().describe('Number of employees'),
              teams: z.array(
                z.object({
                  name: z.string(),
                  lead: z.string().describe('Team lead name'),
                  members: z.number().describe('Team size'),
                  projects: z.array(z.string()).describe('Active project names'),
                })
              ),
            })
          )
          .describe('Company departments'),
      }),
    }),
    prompt:
      'Generate a structure for a mid-sized software company with 3 departments: Engineering, Product, and Marketing. Each should have 2-3 teams.',
  });

  console.log('Generated company structure:');
  console.log(JSON.stringify(object, null, 2));
  console.log();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  try {
    await example1_simpleObject();
    await example2_arraysAndOptional();
    await example3_enumsAndNested();
    await example4_arraysOfObjects();
    await example5_deepNesting();

    console.log('All examples completed!');
  } catch (error) {
    console.error('Error:', error);
    console.log('\nTip: Make sure Claude Code is authenticated with: claude auth login');
  }
}

main().catch(console.error);
