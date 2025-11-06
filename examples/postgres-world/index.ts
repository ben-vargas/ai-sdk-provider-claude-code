/**
 * PostgreSQL World + Claude Code Provider - Main Entry Point
 *
 * This example demonstrates production-grade, durable AI workflows
 * using PostgreSQL as the backend for state persistence and job processing.
 *
 * Prerequisites:
 * 1. PostgreSQL database (local or cloud)
 * 2. Database schema initialized (see setup-db.ts)
 * 3. Environment variables configured (see .env.example)
 * 4. Claude CLI authenticated (`claude login`)
 *
 * Run: npm run example:postgres-world
 *
 * @see README.md for detailed setup instructions
 */

import 'dotenv/config';
import { initializeWorld, stopWorld, getWorldConfig } from './world-config.js';
import {
  contentAnalysisWorkflow,
  multiAgentResearchWorkflow,
} from './workflow-example.js';

/**
 * Main function - orchestrates workflow execution
 */
async function main() {
  console.log('🚀 PostgreSQL World + Claude Code Provider Example\n');
  console.log('═'.repeat(60));

  // Validate environment
  validateEnvironment();

  // Initialize world
  let world;
  try {
    world = await initializeWorld();
  } catch (error) {
    console.error('\n❌ Failed to initialize world:', error);
    console.error('\n💡 Troubleshooting tips:');
    console.error('1. Ensure PostgreSQL is running');
    console.error('2. Verify WORKFLOW_POSTGRES_URL in .env');
    console.error('3. Run database setup: npm run postgres-world:setup');
    console.error('4. Check PostgreSQL logs for connection errors\n');
    process.exit(1);
  }

  console.log('═'.repeat(60));

  try {
    // Choose which example to run based on CLI argument
    const example = process.argv[2] || 'content';

    switch (example) {
      case 'content':
        await runContentAnalysisExample();
        break;

      case 'research':
        await runMultiAgentResearchExample();
        break;

      case 'both':
        await runContentAnalysisExample();
        console.log('\n' + '═'.repeat(60) + '\n');
        await runMultiAgentResearchExample();
        break;

      default:
        console.error(`❌ Unknown example: ${example}`);
        console.log('\nAvailable examples:');
        console.log('  content  - Content analysis workflow (default)');
        console.log('  research - Multi-agent research workflow');
        console.log('  both     - Run both examples\n');
        console.log('Usage: npm run example:postgres-world [example]\n');
        process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Workflow execution failed:', error);
    throw error;
  } finally {
    // Clean shutdown
    console.log('\n' + '═'.repeat(60));
    await stopWorld();
    console.log('\n👋 Example completed\n');
  }
}

/**
 * Example 1: Content Analysis Workflow
 */
async function runContentAnalysisExample() {
  console.log('\n📊 Example 1: Content Analysis Workflow');
  console.log('─'.repeat(60));

  const sampleContent = `
Artificial Intelligence is revolutionizing how we approach complex problems.
Machine learning models can now analyze vast amounts of data in seconds,
uncovering patterns that would take humans years to discover. However,
this rapid advancement also raises important questions about privacy,
bias, and the future of work. We must ensure that AI development remains
aligned with human values and benefits society as a whole.
  `.trim();

  const result = await contentAnalysisWorkflow(sampleContent);

  console.log('\n📋 Results Summary:');
  console.log(`   Sentiment: ${result.sentiment.label} (${result.sentiment.score.toFixed(2)})`);
  console.log(`   Topics: ${result.topics.join(', ')}`);
  console.log(`   Report Length: ${result.report.length} characters`);
  console.log(`   Completed: ${result.completedAt}`);
  console.log(`   Workflow ID: ${result.workflowId}`);
}

/**
 * Example 2: Multi-Agent Research Workflow
 */
async function runMultiAgentResearchExample() {
  console.log('\n🔬 Example 2: Multi-Agent Research Workflow');
  console.log('─'.repeat(60));

  const topic = 'Quantum Computing in Drug Discovery';

  const result = await multiAgentResearchWorkflow(topic);

  console.log('\n📋 Results Summary:');
  console.log(`   Topic: ${result.topic}`);
  console.log(`   Technical Analysis: ${result.findings.technical.length} chars`);
  console.log(`   Business Analysis: ${result.findings.business.length} chars`);
  console.log(`   Ethical Analysis: ${result.findings.ethical.length} chars`);
  console.log(`   Synthesis: ${result.synthesis.length} chars`);
  console.log(`   Completed: ${result.completedAt}`);
}

/**
 * Validate environment setup
 */
function validateEnvironment() {
  const config = getWorldConfig();

  console.log('\n🔍 Environment Check:');

  // Check PostgreSQL URL
  if (!config.connectionString) {
    console.error('❌ WORKFLOW_POSTGRES_URL not set');
    console.error('   Please copy .env.example to .env and configure\n');
    process.exit(1);
  }
  console.log(`   ✅ PostgreSQL URL configured`);

  // Check target world
  const targetWorld = process.env.WORKFLOW_TARGET_WORLD;
  if (targetWorld && targetWorld !== '@workflow/world-postgres') {
    console.warn(`   ⚠️  WORKFLOW_TARGET_WORLD is set to: ${targetWorld}`);
    console.warn('      Expected: @workflow/world-postgres');
  } else {
    console.log('   ✅ Target world configured');
  }

  // Check Claude authentication (optional, will fail later if not authenticated)
  console.log('   ℹ️  Claude Code authentication will be checked during execution');

  console.log('');
}

/**
 * Error handler for uncaught exceptions
 */
process.on('unhandledRejection', async (reason, promise) => {
  console.error('\n❌ Unhandled Promise Rejection:', reason);
  await stopWorld();
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('\n\n⚠️  Received SIGINT, shutting down gracefully...');
  await stopWorld();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n\n⚠️  Received SIGTERM, shutting down gracefully...');
  await stopWorld();
  process.exit(0);
});

// Run main function
main().catch(async (error: Error) => {
  console.error('\n💥 Fatal error:', error.message);
  await stopWorld();
  process.exit(1);
});
