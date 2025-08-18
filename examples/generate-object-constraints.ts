#!/usr/bin/env tsx

/**
 * Constrained Object Generation Examples
 * 
 * This example demonstrates how to use Zod's validation features
 * to create highly constrained objects with the Claude Code provider.
 * 
 * Topics covered:
 * - Enums and literal types
 * - Number ranges and constraints
 * - String patterns and formats
 * - Array length constraints
 * - Complex validation rules
 */

import { createClaudeCode } from '../dist/index.js';
import { generateObject } from 'ai';
import { z } from 'zod';

const claudeCode = createClaudeCode();

console.log('=== Claude Code: Constrained Object Generation ===\n');

// Example 1: Enums and status fields
async function example1_enumsAndStatus() {
  console.log('1️⃣  Enums and Status Fields\n');
  
  const taskSchema = z.object({
    task: z.object({
      id: z.string().uuid().describe('UUID v4'),
      title: z.string().min(5).max(100),
      status: z.enum(['todo', 'in-progress', 'review', 'done', 'archived']),
      priority: z.enum(['low', 'medium', 'high', 'critical']),
      category: z.enum(['bug', 'feature', 'enhancement', 'documentation', 'refactor']),
      assignee: z.object({
        name: z.string(),
        role: z.enum(['developer', 'designer', 'qa', 'manager', 'devops']),
        availability: z.enum(['available', 'busy', 'away', 'offline']),
      }),
      labels: z.array(z.enum(['frontend', 'backend', 'database', 'api', 'ui', 'performance', 'security']))
        .min(1).max(3).describe('1-3 relevant labels'),
    }),
  });

  const { object } = await generateObject({
    model: claudeCode('sonnet'),
    schema: taskSchema,
    prompt: 'Generate a high-priority bug task for a database performance issue, assigned to a senior developer.',
  });

  console.log('Generated task:');
  console.log(JSON.stringify(object, null, 2));
  console.log();
}

// Example 2: Number ranges and constraints
async function example2_numberConstraints() {
  console.log('2️⃣  Number Ranges and Constraints\n');
  
  const gameCharacterSchema = z.object({
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
  });

  const { object } = await generateObject({
    model: claudeCode('sonnet'),
    schema: gameCharacterSchema,
    prompt: 'Generate a level 45 warrior character with balanced stats and moderate inventory.',
  });

  console.log('Generated character:');
  console.log(JSON.stringify(object, null, 2));
  console.log();
}

// Example 3: String patterns and formats
async function example3_stringPatterns() {
  console.log('3️⃣  String Patterns and Formats\n');
  
  const userRegistrationSchema = z.object({
    registration: z.object({
      username: z.string()
        .min(3).max(20)
        .regex(/^[a-zA-Z0-9_]+$/, 'Alphanumeric and underscore only'),
      email: z.string().email(),
      password: z.string()
        .min(8)
        .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]+$/, 
          'Must contain uppercase, lowercase, number, and special character'),
      phone: z.string()
        .regex(/^\+?[1-9]\d{1,14}$/, 'E.164 phone format'),
      dateOfBirth: z.string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD format'),
      socialMedia: z.object({
        twitter: z.string()
          .regex(/^@[a-zA-Z0-9_]{1,15}$/, 'Twitter handle format')
          .optional(),
        github: z.string()
          .regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/, 'GitHub username format')
          .optional(),
        linkedin: z.string()
          .url()
          .regex(/^https:\/\/(?:www\.)?linkedin\.com\/in\//, 'LinkedIn profile URL must start with https://linkedin.com/in/')
          .describe('Full LinkedIn profile URL including https:// protocol')
          .optional(),
      }),
      preferences: z.object({
        timezone: z.string()
          .regex(/^[A-Z][a-z]+\/[A-Z][a-z]+(?:_[A-Z][a-z]+)?$/, 'Timezone format like America/New_York'),
        locale: z.string()
          .regex(/^[a-z]{2}-[A-Z]{2}$/, 'Locale format like en-US'),
        currency: z.string()
          .length(3)
          .regex(/^[A-Z]{3}$/, 'ISO 4217 currency code'),
      }),
    }),
  });

  const { object } = await generateObject({
    model: claudeCode('sonnet'),
    schema: userRegistrationSchema,
    prompt: 'Generate a complete user registration for a software developer from San Francisco. Include GitHub username (just the username) and a complete LinkedIn profile URL like https://www.linkedin.com/in/johndoe-developer',
  });

  console.log('Generated registration:');
  console.log(JSON.stringify(object, null, 2));
  console.log();
}

// Example 4: Array constraints
async function example4_arrayConstraints() {
  console.log('4️⃣  Array Length and Content Constraints\n');
  
  const playlistSchema = z.object({
    playlist: z.object({
      name: z.string().min(1).max(50),
      description: z.string().max(200).optional(),
      isPublic: z.boolean(),
      tracks: z.array(z.object({
        id: z.string(),
        title: z.string().min(1).max(100),
        artist: z.string().min(1).max(50),
        duration: z.number().min(30).max(600).describe('Duration in seconds (30s-10min)'),
        genres: z.array(z.string()).min(1).max(3).describe('1-3 genres per track'),
      })).min(5).max(20).describe('Playlist must have 5-20 tracks'),
      tags: z.array(z.string().min(2).max(20))
        .min(3).max(10)
        .describe('3-10 tags for the playlist'),
      collaborators: z.array(z.string().email())
        .max(5)
        .describe('Up to 5 collaborator emails'),
      artwork: z.object({
        colors: z.array(z.string().regex(/^#[0-9A-F]{6}$/i))
          .length(3)
          .describe('Exactly 3 hex color codes'),
      }),
    }),
  });

  const { object } = await generateObject({
    model: claudeCode('sonnet'),
    schema: playlistSchema,
    prompt: 'Generate a public workout playlist with 8 high-energy tracks from various genres.',
  });

  console.log('Generated playlist:');
  console.log(JSON.stringify(object, null, 2));
  console.log();
}

// Example 5: Complex validation combinations
async function example5_complexValidation() {
  console.log('5️⃣  Complex Combined Validations\n');
  
  const invoiceSchema = z.object({
    invoice: z.object({
      invoiceNumber: z.string()
        .regex(/^INV-\d{4}-\d{6}$/, 'Format: INV-YYYY-XXXXXX'),
      issueDate: z.string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .refine((date) => new Date(date) <= new Date(), 'Issue date cannot be in the future'),
      dueDate: z.string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .describe('Must be after issue date'),
      status: z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled']),
      client: z.object({
        name: z.string().min(2).max(100),
        taxId: z.string().regex(/^\d{2}-\d{7}$|^\d{3}-\d{2}-\d{4}$/, 'Tax ID format'),
        email: z.string().email(),
        address: z.object({
          country: z.string().length(2).regex(/^[A-Z]{2}$/, 'ISO country code'),
          postalCode: z.string().min(3).max(10),
        }),
      }),
      lineItems: z.array(z.object({
        description: z.string().min(5).max(200),
        quantity: z.number().positive().int().max(1000),
        unitPrice: z.number().positive().multipleOf(0.01).max(10000),
        taxRate: z.number().min(0).max(0.30).multipleOf(0.01),
        discount: z.number().min(0).max(0.50).multipleOf(0.01).optional(),
      })).min(1).max(50),
      payment: z.object({
        terms: z.enum(['net-15', 'net-30', 'net-45', 'net-60', 'due-on-receipt']),
        method: z.enum(['bank-transfer', 'credit-card', 'check', 'paypal', 'crypto']).optional(),
        currency: z.string().length(3).regex(/^[A-Z]{3}$/, 'ISO currency code'),
      }),
      totals: z.object({
        subtotal: z.number().positive().multipleOf(0.01),
        taxAmount: z.number().min(0).multipleOf(0.01),
        discountAmount: z.number().min(0).multipleOf(0.01).optional(),
        total: z.number().positive().multipleOf(0.01),
      }),
    }),
  });

  const { object } = await generateObject({
    model: claudeCode('sonnet'),
    schema: invoiceSchema,
    prompt: 'Generate an invoice for web development services with 3 line items, sent to a US company, due in 30 days.',
  });

  console.log('Generated invoice:');
  console.log(JSON.stringify(object, null, 2));
  console.log();
}

// Main execution
async function main() {
  try {
    await example1_enumsAndStatus();
    await example2_numberConstraints();
    await example3_stringPatterns();
    await example4_arrayConstraints();
    await example5_complexValidation();
    
    console.log('✅ All constraint examples completed!');
    console.log('\n📋 Constraint types demonstrated:');
    console.log('- Enums for fixed value sets');
    console.log('- Number ranges with min/max/int/multipleOf');
    console.log('- String patterns with regex validation');
    console.log('- Array length constraints');
    console.log('- Complex combined validations');
    console.log('\n💡 Tip: Clear descriptions help Claude understand the constraints better!');
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

main().catch(console.error);