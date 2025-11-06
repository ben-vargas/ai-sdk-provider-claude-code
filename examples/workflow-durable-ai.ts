/**
 * Workflow DevKit + AI SDK Provider - Durable AI Workflows
 *
 * This example demonstrates using Anthropic's Workflow DevKit with
 * the claude-code provider to create durable, resumable AI workflows.
 *
 * Features:
 * - Automatic retry on transient failures
 * - State persistence across interruptions
 * - Multi-step AI pipelines with delays
 * - Full observability and replay capability
 *
 * @see https://useworkflow.dev - Workflow DevKit documentation
 * @see https://anthropic.com - Claude AI
 */

import { generateText } from 'ai';
import { claudeCode } from '../src/index.js';

/**
 * Example: Research Assistant Workflow
 *
 * This workflow performs multi-step research:
 * 1. Initial research on a topic
 * 2. Wait for human review (simulated delay)
 * 3. Deep dive based on initial findings
 * 4. Generate final report
 *
 * The workflow can suspend/resume at any step.
 */
export async function researchAssistantWorkflow(topic: string) {
  'use workflow';

  console.log(`🔬 Starting research workflow for: ${topic}`);

  // Step 1: Initial research
  const initialResearch = await performInitialResearch(topic);
  console.log(`✅ Initial research complete: ${initialResearch.length} chars`);

  // Step 2: Simulate human review period
  // In production, this could be actual async waiting
  await sleep('5 seconds');
  console.log('⏰ Review period complete');

  // Step 3: Deep dive
  const deepDive = await performDeepDive(topic, initialResearch);
  console.log(`✅ Deep dive complete: ${deepDive.length} chars`);

  // Step 4: Final report
  const report = await generateFinalReport(topic, initialResearch, deepDive);
  console.log(`📄 Final report generated: ${report.length} chars`);

  return {
    topic,
    initialResearch,
    deepDive,
    report,
    completedAt: new Date().toISOString(),
  };
}

/**
 * Step: Perform initial research
 * Marked with "use step" for automatic retry on failures
 */
async function performInitialResearch(topic: string): Promise<string> {
  'use step';

  const model = claudeCode('sonnet', {
    // Enable verbose mode for workflow debugging
    verbose: true,
  });

  const { text } = await generateText({
    model,
    prompt: `Provide a brief overview of ${topic}. Focus on key concepts and recent developments. Keep it under 300 words.`,
  });

  return text;
}

/**
 * Step: Perform deep dive analysis
 */
async function performDeepDive(
  topic: string,
  initialFindings: string,
): Promise<string> {
  'use step';

  const model = claudeCode('sonnet');

  const { text } = await generateText({
    model,
    prompt: `Based on this initial research:\n\n${initialFindings}\n\nProvide a deeper analysis of ${topic}, focusing on technical details and implications. Keep it under 500 words.`,
  });

  return text;
}

/**
 * Step: Generate final report
 */
async function generateFinalReport(
  topic: string,
  initial: string,
  deep: string,
): Promise<string> {
  'use step';

  const model = claudeCode('sonnet');

  const { text } = await generateText({
    model,
    prompt: `Create a comprehensive research report on ${topic}.

Initial Research:
${initial}

Deep Analysis:
${deep}

Structure the report with:
1. Executive Summary
2. Key Findings
3. Technical Details
4. Conclusions

Keep it professional and concise (under 800 words).`,
  });

  return text;
}

/**
 * Utility: Sleep function for workflow delays
 * Workflow DevKit supports human-readable durations
 */
function sleep(duration: string): Promise<void> {
  const ms = parseDuration(duration);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse human-readable duration to milliseconds
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)\s*(seconds?|minutes?|hours?|days?)$/i);
  if (!match) throw new Error(`Invalid duration: ${duration}`);

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  const multipliers: Record<string, number> = {
    second: 1000,
    seconds: 1000,
    minute: 60 * 1000,
    minutes: 60 * 1000,
    hour: 60 * 60 * 1000,
    hours: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
  };

  return value * multipliers[unit];
}

/**
 * Example: Run the workflow
 */
async function main() {
  try {
    const result = await researchAssistantWorkflow(
      'AI Safety and Alignment',
    );

    console.log('\n🎉 Workflow completed successfully!');
    console.log('\n📊 Results:');
    console.log(`Topic: ${result.topic}`);
    console.log(`Completed at: ${result.completedAt}`);
    console.log(`\nInitial Research (${result.initialResearch.length} chars):`);
    console.log(result.initialResearch.substring(0, 200) + '...');
    console.log(`\nDeep Dive (${result.deepDive.length} chars):`);
    console.log(result.deepDive.substring(0, 200) + '...');
    console.log(`\nFinal Report (${result.report.length} chars):`);
    console.log(result.report.substring(0, 200) + '...');
  } catch (error) {
    console.error('❌ Workflow failed:', error);
    throw error;
  }
}

// Run if executed directly (uncomment to test)
// Note: Workflow DevKit requires proper setup before running
// See https://useworkflow.dev for configuration instructions
/*
main().catch((error: Error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
*/
