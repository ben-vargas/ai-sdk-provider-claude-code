/**
 * PostgreSQL World + Claude Code Provider - Durable AI Workflows
 *
 * This example demonstrates using PostgreSQL-backed workflows with the
 * claude-code provider for production-grade, durable AI applications.
 *
 * Key Features:
 * - ✅ Automatic retry on transient failures (via pg-boss)
 * - ✅ State persistence across server restarts (PostgreSQL tables)
 * - ✅ Real-time event streaming (NOTIFY/LISTEN)
 * - ✅ Multi-step AI pipelines with delays
 * - ✅ Full observability and replay capability
 * - ✅ Configurable worker concurrency
 *
 * Use Cases:
 * - Long-running AI workflows (hours/days)
 * - Multi-agent systems with coordination
 * - Background job processing
 * - Workflows that survive server restarts
 * - Production applications requiring durability
 *
 * @see https://useworkflow.dev/docs/deploying/world/postgres-world
 */

import { generateText, streamText } from 'ai';
import { claudeCode } from '../../src/index.js';

/**
 * Content Analysis Workflow
 *
 * This workflow demonstrates a production-grade content analysis pipeline:
 * 1. Initial sentiment analysis
 * 2. Wait period (simulates async processing)
 * 3. Deep topic extraction
 * 4. Final comprehensive report generation
 *
 * Each step is marked with 'use step' for automatic retry on failures.
 * The workflow can be interrupted and resumed at any step.
 *
 * @param content - Content to analyze
 * @returns Analysis results with timestamp
 */
export async function contentAnalysisWorkflow(content: string) {
  'use workflow';

  console.log('\n🔍 Starting content analysis workflow...');
  console.log(`📝 Content length: ${content.length} characters`);

  // Step 1: Sentiment Analysis
  console.log('\n[Step 1/4] Performing sentiment analysis...');
  const sentiment = await analyzeSentiment(content);
  console.log(`✅ Sentiment: ${sentiment.score} (${sentiment.label})`);

  // Step 2: Simulate processing delay
  // In production, this could be waiting for human review, external API, etc.
  console.log('\n[Step 2/4] Waiting for processing window...');
  await sleep('3 seconds');
  console.log('✅ Processing window complete');

  // Step 3: Topic Extraction
  console.log('\n[Step 3/4] Extracting key topics...');
  const topics = await extractTopics(content, sentiment);
  console.log(`✅ Extracted ${topics.length} topics:`, topics.slice(0, 3).join(', '));

  // Step 4: Generate Comprehensive Report
  console.log('\n[Step 4/4] Generating final report...');
  const report = await generateReport(content, sentiment, topics);
  console.log(`✅ Report generated (${report.length} chars)`);

  const result = {
    content,
    sentiment,
    topics,
    report,
    completedAt: new Date().toISOString(),
    workflowId: process.env.WORKFLOW_RUN_ID || 'local',
  };

  console.log('\n🎉 Workflow completed successfully!');
  return result;
}

/**
 * Step 1: Analyze sentiment of content
 * Returns sentiment score and label
 */
async function analyzeSentiment(content: string): Promise<{
  score: number;
  label: string;
  reasoning: string;
}> {
  'use step';

  const model = claudeCode('sonnet', {
    // Enable verbose mode for debugging
    verbose: false,
  });

  const { text } = await generateText({
    model,
    prompt: `Analyze the sentiment of this content and respond in JSON format:

Content:
${content}

Provide:
1. score: number between -1 (very negative) and 1 (very positive)
2. label: one of "positive", "negative", "neutral", "mixed"
3. reasoning: brief explanation (1-2 sentences)

Respond ONLY with valid JSON, no markdown formatting.`,
  });

  // Parse JSON response
  const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleanText);
}

/**
 * Step 2: Extract key topics from content
 */
async function extractTopics(
  content: string,
  sentiment: { score: number; label: string },
): Promise<string[]> {
  'use step';

  const model = claudeCode('sonnet');

  const { text } = await generateText({
    model,
    prompt: `Extract 3-5 key topics from this content.

Content:
${content}

Sentiment Context: ${sentiment.label} (${sentiment.score})

Return ONLY a JSON array of topic strings, no markdown.
Example: ["topic1", "topic2", "topic3"]`,
  });

  const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleanText);
}

/**
 * Step 3: Generate comprehensive report
 * Uses streaming for real-time progress feedback
 */
async function generateReport(
  content: string,
  sentiment: { score: number; label: string; reasoning: string },
  topics: string[],
): Promise<string> {
  'use step';

  const model = claudeCode('sonnet');

  // Use streaming for better UX in long-running workflows
  const { textStream } = streamText({
    model,
    prompt: `Create a comprehensive analysis report.

Original Content:
${content}

Sentiment Analysis:
- Score: ${sentiment.score}
- Label: ${sentiment.label}
- Reasoning: ${sentiment.reasoning}

Key Topics: ${topics.join(', ')}

Generate a structured report with:
1. Executive Summary (2-3 sentences)
2. Sentiment Overview
3. Key Topics Analysis
4. Recommendations

Keep it professional and concise (300-400 words).`,
  });

  // Stream and collect response
  let fullReport = '';
  for await (const chunk of textStream) {
    fullReport += chunk;
    // In production, you could emit progress events here
    process.stdout.write(chunk);
  }
  console.log('\n'); // New line after streaming

  return fullReport;
}

/**
 * Multi-Agent Research Workflow
 *
 * Demonstrates a more complex workflow with parallel processing
 * and coordination between multiple AI agents.
 */
export async function multiAgentResearchWorkflow(topic: string) {
  'use workflow';

  console.log(`\n🔬 Starting multi-agent research on: ${topic}`);

  // Parallel research by multiple specialized agents
  console.log('\n[Phase 1] Parallel research by specialized agents...');

  const [technical, business, ethical] = await Promise.all([
    researchTechnicalAspects(topic),
    researchBusinessImpact(topic),
    researchEthicalConsiderations(topic),
  ]);

  console.log('✅ All agents completed research');

  // Synthesis by coordinator agent
  console.log('\n[Phase 2] Synthesizing findings...');
  const synthesis = await synthesizeFindings(topic, {
    technical,
    business,
    ethical,
  });

  console.log('✅ Synthesis complete');

  return {
    topic,
    findings: { technical, business, ethical },
    synthesis,
    completedAt: new Date().toISOString(),
  };
}

/**
 * Technical research agent
 */
async function researchTechnicalAspects(topic: string): Promise<string> {
  'use step';

  const model = claudeCode('sonnet');
  const { text } = await generateText({
    model,
    prompt: `You are a technical research specialist. Provide a brief technical analysis of: ${topic}

Focus on: architecture, implementation, scalability, performance.
Keep it under 200 words.`,
  });

  return text;
}

/**
 * Business research agent
 */
async function researchBusinessImpact(topic: string): Promise<string> {
  'use step';

  const model = claudeCode('sonnet');
  const { text } = await generateText({
    model,
    prompt: `You are a business analyst. Analyze the business impact of: ${topic}

Focus on: market opportunities, ROI, competitive advantage, risks.
Keep it under 200 words.`,
  });

  return text;
}

/**
 * Ethics research agent
 */
async function researchEthicalConsiderations(topic: string): Promise<string> {
  'use step';

  const model = claudeCode('sonnet');
  const { text } = await generateText({
    model,
    prompt: `You are an ethics specialist. Analyze ethical considerations for: ${topic}

Focus on: privacy, bias, fairness, societal impact.
Keep it under 200 words.`,
  });

  return text;
}

/**
 * Synthesis coordinator agent
 */
async function synthesizeFindings(
  topic: string,
  findings: { technical: string; business: string; ethical: string },
): Promise<string> {
  'use step';

  const model = claudeCode('sonnet');
  const { text } = await generateText({
    model,
    prompt: `Synthesize these research findings into a cohesive executive summary.

Topic: ${topic}

Technical Analysis:
${findings.technical}

Business Analysis:
${findings.business}

Ethical Analysis:
${findings.ethical}

Create a balanced synthesis covering all perspectives. 300-400 words.`,
  });

  return text;
}

/**
 * Utility: Sleep function for workflow delays
 */
function sleep(duration: string): Promise<void> {
  const ms = parseDuration(duration);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse human-readable duration to milliseconds
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)\s*(seconds?|minutes?|hours?)$/i);
  if (!match) throw new Error(`Invalid duration: ${duration}`);

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  const multipliers: Record<string, number> = {
    second: 1000,
    seconds: 1000,
    minute: 60_000,
    minutes: 60_000,
    hour: 3_600_000,
    hours: 3_600_000,
  };

  return value * multipliers[unit];
}
