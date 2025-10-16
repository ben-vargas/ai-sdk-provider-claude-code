#!/usr/bin/env tsx

/**
 * Nested Object Generation Examples
 *
 * This example demonstrates how to generate complex nested structures
 * using the Claude Code provider.
 *
 * Topics covered:
 * - Deeply nested objects
 * - Arrays of objects
 * - Complex data relationships
 * - Hierarchical structures
 */

import { createClaudeCode } from '../dist/index.js';
import { generateObject } from 'ai';
import { z } from 'zod';

const claudeCode = createClaudeCode();

console.log('=== Claude Code: Nested Object Generation ===\n');

// Example 1: Company structure with departments
async function example1_companyStructure() {
  console.log('1️⃣  Company with Departments and Teams\n');

  const companySchema = z.object({
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
  });

  const { object } = await generateObject({
    model: claudeCode('haiku'),
    schema: companySchema,
    prompt:
      'Generate a structure for a mid-sized software company with 3 departments: Engineering, Product, and Marketing. Each should have 2-3 teams.',
  });

  console.log('Generated company structure:');
  console.log(JSON.stringify(object, null, 2));
  console.log();
}

// Example 2: E-commerce order with nested items
async function example2_ecommerceOrder() {
  console.log('2️⃣  E-commerce Order with Nested Details\n');

  const orderSchema = z.object({
    order: z.object({
      orderId: z.string().describe('Unique order ID'),
      customer: z.object({
        id: z.string(),
        name: z.string(),
        email: z.string().email(),
        address: z.object({
          street: z.string(),
          city: z.string(),
          state: z.string(),
          zipCode: z.string(),
          country: z.string(),
        }),
      }),
      items: z
        .array(
          z.object({
            productId: z.string(),
            name: z.string(),
            category: z.string(),
            quantity: z.number().positive(),
            unitPrice: z.number().positive(),
            variations: z
              .object({
                size: z.string().optional(),
                color: z.string().optional(),
                customization: z.string().optional(),
              })
              .optional(),
            subtotal: z.number().positive(),
          })
        )
        .min(1)
        .describe('Order items'),
      payment: z.object({
        method: z.string().describe('Payment method'),
        status: z.string().describe('Payment status'),
        card: z
          .object({
            last4: z.string().length(4),
            brand: z.string(),
          })
          .optional(),
      }),
      totals: z.object({
        subtotal: z.number(),
        tax: z.number(),
        shipping: z.number(),
        discount: z.number().optional(),
        total: z.number(),
      }),
    }),
  });

  const { object } = await generateObject({
    model: claudeCode('haiku'),
    schema: orderSchema,
    prompt:
      'Generate an e-commerce order for a customer buying 3 different clothing items with variations. Include a discount.',
  });

  console.log('Generated order:');
  console.log(JSON.stringify(object, null, 2));
  console.log();
}

// Example 3: Configuration file with nested settings
async function example3_configurationFile() {
  console.log('3️⃣  Application Configuration with Nested Settings\n');

  const configSchema = z.object({
    application: z.object({
      name: z.string(),
      version: z.string().describe('Semantic version'),
      environment: z.string(),
      features: z.object({
        authentication: z.object({
          enabled: z.boolean(),
          providers: z.array(z.string()),
          sessionTimeout: z.number().describe('Timeout in minutes'),
          twoFactor: z.object({
            enabled: z.boolean(),
            methods: z.array(z.string()),
          }),
        }),
        api: z.object({
          version: z.string(),
          rateLimit: z.object({
            enabled: z.boolean(),
            requests: z.number().describe('Requests per minute'),
            burst: z.number().describe('Burst limit'),
          }),
          cors: z.object({
            enabled: z.boolean(),
            origins: z.array(z.string()),
            credentials: z.boolean(),
          }),
        }),
        database: z.object({
          type: z.string(),
          connection: z.object({
            host: z.string(),
            port: z.number(),
            database: z.string(),
            ssl: z.boolean(),
          }),
          pool: z.object({
            min: z.number(),
            max: z.number(),
            idleTimeout: z.number(),
          }),
        }),
      }),
      monitoring: z.object({
        logging: z.object({
          level: z.string(),
          outputs: z.array(z.string()),
          rotation: z.object({
            enabled: z.boolean(),
            maxSize: z.string(),
            maxFiles: z.number(),
          }),
        }),
        metrics: z.object({
          enabled: z.boolean(),
          interval: z.number().describe('Collection interval in seconds'),
          exporters: z.array(z.string()),
        }),
      }),
    }),
  });

  const { object } = await generateObject({
    model: claudeCode('haiku'),
    schema: configSchema,
    prompt:
      'Generate a production configuration for a SaaS application with comprehensive security and monitoring settings.',
  });

  console.log('Generated configuration:');
  console.log(JSON.stringify(object, null, 2));
  console.log();
}

// Example 4: Social media post with nested engagement data
async function example4_socialMediaPost() {
  console.log('4️⃣  Social Media Post with Engagement Hierarchy\n');

  const postSchema = z.object({
    post: z.object({
      id: z.string(),
      author: z.object({
        id: z.string(),
        username: z.string(),
        displayName: z.string(),
        verified: z.boolean(),
        followerCount: z.number(),
      }),
      content: z.object({
        text: z.string().max(280),
        media: z
          .array(
            z.object({
              type: z.string().describe('image, video, or gif'),
              url: z.string().url(),
              alt: z.string().optional(),
              dimensions: z
                .object({
                  width: z.number(),
                  height: z.number(),
                })
                .optional(),
            })
          )
          .optional(),
        mentions: z.array(z.string()).optional(),
        hashtags: z.array(z.string()).optional(),
      }),
      engagement: z.object({
        likes: z.number(),
        reposts: z.number(),
        comments: z.object({
          count: z.number(),
          topComments: z
            .array(
              z.object({
                id: z.string(),
                author: z.object({
                  username: z.string(),
                  displayName: z.string(),
                }),
                text: z.string(),
                likes: z.number(),
                replies: z.number(),
              })
            )
            .max(3),
        }),
      }),
      metadata: z.object({
        createdAt: z.string().describe('ISO 8601 datetime'),
        source: z.string().describe('Platform or app used'),
        location: z
          .object({
            name: z.string(),
            coordinates: z
              .object({
                lat: z.number(),
                lng: z.number(),
              })
              .optional(),
          })
          .optional(),
      }),
    }),
  });

  const { object } = await generateObject({
    model: claudeCode('haiku'),
    schema: postSchema,
    prompt:
      'Generate a viral tech announcement post with high engagement, media attachments, and top comments.',
  });

  console.log('Generated social media post:');
  console.log(JSON.stringify(object, null, 2));
  console.log();
}

// Example 5: File system structure
async function example5_fileSystemStructure() {
  console.log('5️⃣  File System Directory Tree\n');

  // Simplified non-recursive schema to avoid infinite loops
  const fileNodeSchema = z.object({
    name: z.string().describe('File or directory name'),
    type: z.enum(['file', 'directory']),
    size: z.number().optional().describe('Size in bytes for files'),
    extension: z.string().optional().describe('File extension without dot'),
    // Limited depth to prevent recursion issues
    children: z
      .array(
        z.object({
          name: z.string(),
          type: z.enum(['file', 'directory']),
          size: z.number().optional(),
          extension: z.string().optional(),
          // Only go 2 levels deep
          children: z
            .array(
              z.object({
                name: z.string(),
                type: z.enum(['file', 'directory']),
                size: z.number().optional(),
                extension: z.string().optional(),
              })
            )
            .optional(),
        })
      )
      .optional()
      .describe('Subdirectories and files'),
  });

  const projectSchema = z.object({
    project: z.object({
      root: z.string().describe('Project root directory name'),
      totalSize: z.number().describe('Total size in bytes'),
      fileCount: z.number(),
      structure: fileNodeSchema,
    }),
  });

  try {
    const { object } = await generateObject({
      model: claudeCode('haiku'),
      schema: projectSchema,
      prompt:
        'Generate a typical Next.js project file structure with src directory, showing 2 levels deep. Include common files like package.json, tsconfig.json, and directories like src, public, and components.',
    });

    console.log('Generated file structure:');
    console.log(JSON.stringify(object, null, 2));
  } catch (error: any) {
    console.error('❌ Error generating file structure:', error.message);
    console.log(
      '💡 Tip: Complex recursive schemas can be challenging. Consider using fixed-depth schemas instead.'
    );
  }
  console.log();
}

// Main execution
async function main() {
  try {
    await example1_companyStructure();
    await example2_ecommerceOrder();
    await example3_configurationFile();
    await example4_socialMediaPost();
    await example5_fileSystemStructure();

    console.log('✅ All nested structure examples completed!');
    console.log('\n💡 Key takeaways:');
    console.log('- Break complex structures into logical sub-objects');
    console.log('- Use descriptive field names and descriptions');
    console.log('- Arrays of objects work well for repeated structures');
    console.log('- Consider using recursive schemas for tree-like data');
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

main().catch(console.error);
// NOTE: Migrating to Claude Agent SDK:
// - System prompt is not applied by default
// - Filesystem settings (CLAUDE.md, settings.json) are not loaded by default
// To restore old behavior, set when creating model instances, e.g.:
//   systemPrompt: { type: 'preset', preset: 'claude_code' }
//   settingSources: ['user', 'project', 'local']
