#!/usr/bin/env tsx

/**
 * Regression Check: Claude Code CLI Structured Output for JSON Schema Features
 *
 * Calls the Claude Agent SDK directly (bypassing this provider's schema
 * sanitizer) with `outputFormat` schemas that use features which older Claude
 * Code CLI releases mishandled.
 *
 * HISTORY:
 * - Older CLI releases silently fell back to unstructured prose (subtype
 *   "success", no `structured_output`) for `format` constraints (email, uri,
 *   date-time, ...) and for complex regex patterns with lookaheads. This is
 *   why the provider strips `format` keywords before calling the CLI.
 *
 * CURRENT BEHAVIOR (verified with Claude Code CLI 2.1.283 and 2.1.310):
 * - Every case below returns `structured_output`.
 *
 * This script now acts as a regression check: it prints the CLI version and a
 * per-case PASS/FAIL table, and exits non-zero if any case falls back to
 * prose (or errors) again.
 *
 * Run: npx tsx examples/structured-output-repro.ts
 */

import { query } from '@anthropic-ai/claude-agent-sdk';

interface TestCase {
  name: string;
  schema: Record<string, unknown>;
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
  },
];

let cliVersion = 'unknown';

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
      if (message.type === 'system' && message.subtype === 'init') {
        cliVersion = message.claude_code_version;
      }
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
    results.push(result);
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

  const regressions = results.filter((r) => !r.hasStructuredOutput);

  console.log();
  console.log('='.repeat(80));
  console.log(`REGRESSION CHECK (Claude Code CLI ${cliVersion})`);
  console.log('='.repeat(80));
  console.log();
  for (const r of results) {
    console.log(`  ${r.hasStructuredOutput ? 'PASS' : 'FAIL'}  ${r.name}`);
  }
  console.log();

  if (regressions.length === 0) {
    console.log('All cases returned structured_output. No prose fallback detected.');
    console.log();
    return;
  }

  console.log(`${regressions.length} case(s) returned no structured_output (prose fallback).`);
  console.log('This matches the behavior of older CLI releases. Workaround: use a');
  console.log('simplified generation schema without these features, then validate the');
  console.log('result client-side with the full schema.');
  console.log();
  process.exitCode = 1;
}

main().catch(console.error);
