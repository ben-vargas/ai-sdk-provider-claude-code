#!/usr/bin/env tsx

/**
 * Minimal Reproduction: Claude Code CLI Structured Output Silent Fallback
 *
 * This script demonstrates that the Claude Code CLI silently falls back to
 * unstructured prose output when JSON schemas contain certain features,
 * instead of returning `structured_output` or `error_max_structured_output_retries`.
 *
 * EXPECTED BEHAVIOR (per SDK docs):
 * - Schemas with supported features → result.structured_output contains JSON
 * - Schemas with unsupported features → result.subtype === 'error_max_structured_output_retries'
 *
 * ACTUAL BEHAVIOR:
 * - Schemas with unsupported features → Silent fallback to prose text, no error
 *
 * Affected features:
 * - `format` constraints (email, uri, date-time, etc.)
 * - Complex regex patterns (lookaheads, lookbehinds, backreferences)
 *
 * Run: npx tsx examples/structured-output-repro.ts
 */

import { query } from '@anthropic-ai/claude-agent-sdk';

interface TestCase {
  name: string;
  schema: Record<string, unknown>;
  expectedToWork: boolean;
}

const testCases: TestCase[] = [
  {
    name: 'Baseline (no format, no pattern)',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
      },
      required: ['name', 'email'],
      additionalProperties: false,
    },
    expectedToWork: true,
  },
  {
    name: 'format: "email" only',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
      },
      required: ['name', 'email'],
      additionalProperties: false,
    },
    expectedToWork: false, // Docs say supported, but CLI fails silently
  },
  {
    name: 'format: "uri"',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        website: { type: 'string', format: 'uri' },
      },
      required: ['name', 'website'],
      additionalProperties: false,
    },
    expectedToWork: false,
  },
  {
    name: 'Simple pattern (no lookahead)',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string', pattern: '^[a-z]+@[a-z]+\\.[a-z]+$' },
      },
      required: ['name', 'email'],
      additionalProperties: false,
    },
    expectedToWork: true,
  },
  {
    name: 'Pattern with lookahead (Zod .email() style)',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: {
          type: 'string',
          pattern:
            "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$",
        },
      },
      required: ['name', 'email'],
      additionalProperties: false,
    },
    expectedToWork: false,
  },
];

async function runTest(testCase: TestCase): Promise<{
  name: string;
  hasStructuredOutput: boolean;
  isValidJson: boolean;
  subtype: string;
  outputPreview: string;
}> {
  let hasStructuredOutput = false;
  let isValidJson = false;
  let subtype = '';
  let outputPreview = '';

  try {
    for await (const message of query({
      prompt: 'Generate a user profile with name and email for Sarah.',
      options: {
        outputFormat: {
          type: 'json_schema',
          schema: testCase.schema,
        },
        model: 'sonnet',
        maxTurns: 3,
      },
    })) {
      if (message.type === 'result') {
        subtype = message.subtype;
        const structuredOutput = (message as { structured_output?: unknown }).structured_output;
        hasStructuredOutput = structuredOutput !== undefined;

        if (hasStructuredOutput) {
          outputPreview = JSON.stringify(structuredOutput).substring(0, 60);
          isValidJson = true;
        } else if ('result' in message && message.result) {
          outputPreview = message.result.substring(0, 60);
          try {
            JSON.parse(message.result);
            isValidJson = true;
          } catch {
            isValidJson = false;
          }
        }
      }
    }
  } catch (error) {
    outputPreview = `Error: ${(error as Error).message}`;
  }

  return { name: testCase.name, hasStructuredOutput, isValidJson, subtype, outputPreview };
}

async function main() {
  console.log('='.repeat(80));
  console.log('Claude Code CLI Structured Output Repro');
  console.log('='.repeat(80));
  console.log();
  console.log('Testing various JSON Schema features with outputFormat...');
  console.log();

  const results = [];

  for (const testCase of testCases) {
    process.stdout.write(`Testing: ${testCase.name}... `);
    const result = await runTest(testCase);
    results.push({ ...result, expectedToWork: testCase.expectedToWork });
    console.log(
      result.hasStructuredOutput
        ? 'structured_output'
        : result.isValidJson
          ? 'JSON in result'
          : 'PROSE'
    );
  }

  console.log();
  console.log('='.repeat(80));
  console.log('RESULTS');
  console.log('='.repeat(80));
  console.log();
  console.log(
    '| Test Case                              | structured_output | Valid JSON | Subtype  |'
  );
  console.log(
    '|----------------------------------------|-------------------|------------|----------|'
  );

  for (const r of results) {
    const name = r.name.padEnd(38);
    const structured = (r.hasStructuredOutput ? 'YES' : 'NO').padEnd(17);
    const json = (r.isValidJson ? 'YES' : 'NO').padEnd(10);
    const st = r.subtype.padEnd(8);
    console.log(`| ${name} | ${structured} | ${json} | ${st} |`);
  }

  console.log();
  console.log('OUTPUT PREVIEWS:');
  for (const r of results) {
    console.log(`  ${r.name}: ${r.outputPreview}...`);
  }

  console.log();
  console.log('='.repeat(80));
  console.log('BUG SUMMARY');
  console.log('='.repeat(80));
  console.log();
  console.log('EXPECTED: Unsupported schema features should return:');
  console.log('  - subtype: "error_max_structured_output_retries"');
  console.log('  - OR: An error indicating the schema is not supported');
  console.log();
  console.log('ACTUAL: Unsupported schema features cause:');
  console.log('  - Silent fallback to unstructured prose');
  console.log('  - subtype: "success" (misleading)');
  console.log('  - No structured_output field');
  console.log();
  console.log('AFFECTED FEATURES:');
  console.log('  - format: "email", "uri", "date-time", etc. (consistently fails)');
  console.log('  - pattern: Complex regex may be flaky (sometimes works, sometimes fails)');
  console.log();
  console.log('WORKAROUND:');
  console.log('  Use simplified schemas without format constraints for generation,');
  console.log('  then validate with full schema client-side after receiving output.');
  console.log();
}

main().catch(console.error);
