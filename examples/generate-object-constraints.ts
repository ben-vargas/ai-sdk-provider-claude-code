#!/usr/bin/env tsx

/**
 * Constrained Object Generation Examples
 *
 * Demonstrates validation constraints that the Claude Code CLI can enforce
 * via constrained decoding: number ranges, simple regex patterns, array
 * lengths, enums, and multipleOf.
 *
 * NOTE: Avoid Zod methods that produce unsupported JSON Schema annotations:
 * .email(), .url(), .uuid(), .datetime() all emit `format` constraints that
 * cause the Claude Code CLI to silently fall back to prose. Use .describe()
 * with format hints instead, then validate client-side if strict format
 * compliance is needed.
 *
 * Regex patterns WITHOUT lookaheads/lookbehinds work fine (e.g. /^\d{4}-\d{2}-\d{2}$/).
 * Regex patterns WITH lookaheads ((?=...), (?!...)) cause silent fallback.
 *
 * See JSON_FIX.md for details.
 */

import { createClaudeCode } from '../dist/index.js';
import { generateObject } from 'ai';
import { z } from 'zod';

const claudeCode = createClaudeCode();

console.log('=== Claude Code: Constrained Object Generation ===\n');

// ---------------------------------------------------------------------------
// Example 1: Number ranges and integer constraints
// ---------------------------------------------------------------------------
async function example1_numberConstraints() {
  console.log('1. Number Ranges and Integer Constraints\n');

  const { object } = await generateObject({
    model: claudeCode('opus'),
    schema: z.object({
      character: z.object({
        name: z.string().min(3).max(20).describe('Character name'),
        level: z.number().int().min(1).max(100),
        experience: z.number().int().min(0).max(1000000),
        stats: z.object({
          health: z.number().int().min(100).max(9999),
          mana: z.number().int().min(0).max(9999),
          strength: z.number().int().min(1).max(99),
          defense: z.number().int().min(1).max(99),
          speed: z.number().int().min(1).max(99),
          luck: z.number().int().min(1).max(10).describe('Luck stat (1-10)'),
        }),
        inventory: z.object({
          gold: z.number().int().min(0).max(999999),
          items: z.number().int().min(0).max(50).describe('Number of items (max 50)'),
          weight: z.number().min(0).max(100).describe('Inventory weight in kg'),
        }),
        position: z.object({
          x: z.number().min(-1000).max(1000),
          y: z.number().min(-1000).max(1000),
          z: z.number().min(0).max(500).describe('Altitude'),
        }),
      }),
    }),
    prompt: 'Generate a level 45 warrior character with balanced stats and moderate inventory.',
  });

  console.log('Generated character:');
  console.log(JSON.stringify(object, null, 2));
  console.log();
}

// ---------------------------------------------------------------------------
// Example 2: String patterns, enums, and array constraints
// ---------------------------------------------------------------------------
async function example2_patternsAndArrays() {
  console.log('2. String Patterns, Enums, and Array Constraints\n');

  const { object } = await generateObject({
    model: claudeCode('opus'),
    schema: z.object({
      registration: z.object({
        // Simple regex (no lookaheads) — works with CLI constrained decoding
        username: z
          .string()
          .min(3)
          .max(20)
          .regex(/^[a-zA-Z0-9_]+$/, 'Alphanumeric and underscore only'),
        email: z.string().describe('Email address (e.g. user@example.com)'),
        phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'E.164 phone format'),
        dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD format'),
        socialMedia: z.object({
          twitter: z
            .string()
            .regex(/^@[a-zA-Z0-9_]{1,15}$/, 'Twitter handle format')
            .optional(),
          github: z
            .string()
            .describe('GitHub username (alphanumeric or hyphens, 1-39 characters)')
            .optional(),
        }),
        preferences: z.object({
          locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/, 'Locale format like en-US'),
          currency: z
            .string()
            .length(3)
            .regex(/^[A-Z]{3}$/, 'ISO 4217 currency code'),
        }),
      }),
    }),
    prompt:
      'Generate a user registration for a software developer from San Francisco with a GitHub account.',
  });

  console.log('Generated registration:');
  console.log(JSON.stringify(object, null, 2));
  console.log();
}

// ---------------------------------------------------------------------------
// Example 3: Complex combined validations (invoice)
// ---------------------------------------------------------------------------
async function example3_complexCombined() {
  console.log('3. Complex Combined Validations\n');

  const { object } = await generateObject({
    model: claudeCode('opus'),
    schema: z.object({
      invoice: z.object({
        invoiceNumber: z.string().regex(/^INV-\d{4}-\d{6}$/, 'Format: INV-YYYY-XXXXXX'),
        issueDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe('Issue date in YYYY-MM-DD format'),
        dueDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe('Due date in YYYY-MM-DD format (after issue date)'),
        status: z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled']),
        client: z.object({
          name: z.string().min(2).max(100),
          taxId: z.string().regex(/^\d{2}-\d{7}$|^\d{3}-\d{2}-\d{4}$/, 'Tax ID format'),
          email: z.string().describe('Client email address (e.g. billing@company.com)'),
          address: z.object({
            country: z
              .string()
              .length(2)
              .regex(/^[A-Z]{2}$/, 'ISO country code'),
            postalCode: z.string().min(3).max(10),
          }),
        }),
        lineItems: z
          .array(
            z.object({
              description: z.string().min(5).max(200),
              quantity: z.number().positive().int().max(1000),
              unitPrice: z.number().positive().multipleOf(0.01).max(10000),
              taxRate: z.number().min(0).max(0.3).multipleOf(0.01),
              discount: z.number().min(0).max(0.5).multipleOf(0.01).optional(),
            })
          )
          .min(1)
          .max(50),
        payment: z.object({
          terms: z.enum(['net-15', 'net-30', 'net-45', 'net-60', 'due-on-receipt']),
          method: z.enum(['bank-transfer', 'credit-card', 'check', 'paypal', 'crypto']).optional(),
          currency: z
            .string()
            .length(3)
            .regex(/^[A-Z]{3}$/, 'ISO currency code'),
        }),
        totals: z.object({
          subtotal: z.number().positive().multipleOf(0.01),
          taxAmount: z.number().min(0).multipleOf(0.01),
          discountAmount: z.number().min(0).multipleOf(0.01).optional(),
          total: z.number().positive().multipleOf(0.01),
        }),
      }),
    }),
    prompt:
      'Generate an invoice for web development services with 3 line items, sent to a US company, due in 30 days. Use a recent issue date and set the due date 30 days later.',
  });

  console.log('Generated invoice:');
  console.log(JSON.stringify(object, null, 2));
  console.log();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  try {
    await example1_numberConstraints();
    await example2_patternsAndArrays();
    await example3_complexCombined();

    console.log('All constraint examples completed!');
    console.log('\nConstraint types demonstrated:');
    console.log('- Number ranges with min/max/int/multipleOf');
    console.log('- Simple regex patterns (no lookaheads)');
    console.log('- String length constraints');
    console.log('- Array length constraints (min/max)');
    console.log('- Enums for fixed value sets');
    console.log('- Complex combined validations');
  } catch (error) {
    console.error('Error:', error);
  }
}

main().catch(console.error);
