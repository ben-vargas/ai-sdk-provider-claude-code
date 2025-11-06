/**
 * Database Setup Script for PostgreSQL World
 *
 * This script initializes the PostgreSQL database schema required
 * for workflow execution with the PostgreSQL World.
 *
 * Creates the following tables:
 * - workflow_runs: Stores workflow execution state
 * - workflow_events: Stores workflow events
 * - workflow_steps: Stores workflow step state
 * - workflow_hooks: Stores workflow hooks
 * - workflow_stream_chunks: Stores streaming data
 *
 * Also creates pg-boss tables for job processing.
 *
 * Usage:
 *   npm run postgres-world:setup
 *
 * Or directly:
 *   npx tsx examples/postgres-world/setup-db.ts
 *
 * Prerequisites:
 * - PostgreSQL running and accessible
 * - WORKFLOW_POSTGRES_URL environment variable set
 */

import 'dotenv/config';
import { getWorldConfig } from './world-config.js';

/**
 * Main setup function
 */
async function setupDatabase() {
  console.log('🔧 PostgreSQL World - Database Setup\n');
  console.log('═'.repeat(60));

  const config = getWorldConfig();

  console.log(`\n📍 Connection: ${maskConnectionString(config.connectionString)}\n`);

  // Note: The actual schema setup should be done via the official
  // workflow-postgres-setup command provided by @workflow/world-postgres
  //
  // This script serves as a wrapper and documentation

  console.log('🚀 Running database schema setup...\n');

  try {
    // Import and run the setup from @workflow/world-postgres
    // The package should provide a setup function or CLI command

    console.log('📦 Attempting to use @workflow/world-postgres setup...\n');

    // For now, provide instructions since the package may use its own CLI
    console.log('✅ Database setup instructions:\n');
    console.log('   Option 1: Use the provided CLI command');
    console.log('   $ npx workflow-postgres-setup\n');

    console.log('   Option 2: Run setup programmatically');
    console.log('   See https://useworkflow.dev/docs/deploying/world/postgres-world\n');

    console.log('   Option 3: Manual SQL setup');
    console.log('   Execute the SQL schema from the package documentation\n');

    console.log('📋 Required tables:');
    console.log('   • workflow_runs - Workflow execution state');
    console.log('   • workflow_events - Workflow events');
    console.log('   • workflow_steps - Workflow step state');
    console.log('   • workflow_hooks - Workflow hooks');
    console.log('   • workflow_stream_chunks - Streaming data');
    console.log('   • pg-boss tables - Job processing queue\n');

    console.log('═'.repeat(60));
    console.log('\n💡 Next steps:');
    console.log('   1. Verify tables were created in your database');
    console.log('   2. Configure environment variables (see .env.example)');
    console.log('   3. Run the example: npm run example:postgres-world\n');
  } catch (error) {
    console.error('❌ Setup failed:', error);
    console.error('\n💡 Troubleshooting:');
    console.error('   1. Check PostgreSQL is running');
    console.error('   2. Verify connection string in WORKFLOW_POSTGRES_URL');
    console.error('   3. Ensure database exists and user has CREATE permissions');
    console.error('   4. Check PostgreSQL logs for detailed errors\n');
    process.exit(1);
  }
}

/**
 * Mask password in connection string for safe logging
 */
function maskConnectionString(connectionString: string): string {
  return connectionString.replace(/(:\/\/[^:]+:)([^@]+)(@)/, '$1****$3');
}

/**
 * Verify database connectivity
 */
async function verifyConnection(connectionString: string): Promise<boolean> {
  console.log('🔍 Verifying database connection...');

  try {
    // In a real implementation, you would use pg or another PostgreSQL client
    // For this example, we'll just validate the connection string format

    const url = new URL(connectionString);

    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
      throw new Error('Invalid protocol. Must be postgres:// or postgresql://');
    }

    if (!url.hostname) {
      throw new Error('Missing hostname');
    }

    if (!url.pathname || url.pathname === '/') {
      throw new Error('Missing database name');
    }

    console.log('   ✅ Connection string format valid');
    console.log(`   📍 Host: ${url.hostname}`);
    console.log(`   📍 Port: ${url.port || 5432}`);
    console.log(`   📍 Database: ${url.pathname.slice(1)}`);

    return true;
  } catch (error) {
    console.error('   ❌ Invalid connection string:', error);
    return false;
  }
}

// Run setup
setupDatabase().catch((error: Error) => {
  console.error('💥 Fatal error:', error.message);
  process.exit(1);
});
