/**
 * PostgreSQL World Configuration
 *
 * This module initializes and configures the PostgreSQL-backed workflow world.
 * The world provides:
 * - Durable job processing with pg-boss
 * - Event streaming via PostgreSQL NOTIFY/LISTEN
 * - State persistence in PostgreSQL tables
 * - Configurable worker concurrency
 *
 * @see https://useworkflow.dev/docs/deploying/world/postgres-world
 */

import { createWorld } from '@workflow/world-postgres';

/**
 * World instance (singleton)
 * Initialized once and reused across the application
 */
let worldInstance: ReturnType<typeof createWorld> | null = null;

/**
 * Configuration options for PostgreSQL World
 */
export interface WorldConfig {
  /** PostgreSQL connection string */
  connectionString: string;
  /** Prefix for queue job names (default: 'workflow_') */
  jobPrefix?: string;
  /** Number of concurrent workers (default: 10) */
  queueConcurrency?: number;
  /** Enable verbose logging (default: false) */
  verbose?: boolean;
}

/**
 * Get configuration from environment variables
 */
export function getWorldConfig(): WorldConfig {
  const connectionString =
    process.env.WORKFLOW_POSTGRES_URL ||
    'postgres://postgres:postgres@localhost:5432/workflow_dev';

  const jobPrefix = process.env.WORKFLOW_POSTGRES_JOB_PREFIX || 'workflow_';

  const queueConcurrency = parseInt(
    process.env.WORKFLOW_POSTGRES_WORKER_CONCURRENCY || '10',
    10,
  );

  const verbose = process.env.WORKFLOW_VERBOSE === 'true';

  return {
    connectionString,
    jobPrefix,
    queueConcurrency,
    verbose,
  };
}

/**
 * Initialize the PostgreSQL world
 * Creates and configures a world instance with the provided configuration
 *
 * @param config - World configuration options
 * @returns Initialized world instance
 *
 * @example
 * ```typescript
 * const world = await initializeWorld({
 *   connectionString: 'postgres://localhost:5432/mydb',
 *   jobPrefix: 'my_app_',
 *   queueConcurrency: 20,
 * });
 * ```
 */
export async function initializeWorld(
  config?: Partial<WorldConfig>,
): Promise<ReturnType<typeof createWorld>> {
  if (worldInstance) {
    console.log('♻️  Reusing existing world instance');
    return worldInstance;
  }

  const finalConfig = {
    ...getWorldConfig(),
    ...config,
  };

  console.log('🌍 Initializing PostgreSQL World...');
  console.log(`📍 Connection: ${maskConnectionString(finalConfig.connectionString)}`);
  console.log(`🏷️  Job Prefix: ${finalConfig.jobPrefix}`);
  console.log(`⚙️  Worker Concurrency: ${finalConfig.queueConcurrency}`);

  try {
    worldInstance = createWorld({
      connectionString: finalConfig.connectionString,
      jobPrefix: finalConfig.jobPrefix,
      queueConcurrency: finalConfig.queueConcurrency,
    });

    // Start the world (begins processing jobs)
    if (worldInstance.start) {
      await worldInstance.start();
      console.log('✅ World started successfully');
    }

    return worldInstance;
  } catch (error) {
    console.error('❌ Failed to initialize world:', error);
    throw error;
  }
}

/**
 * Get the current world instance
 * Throws if world hasn't been initialized
 *
 * @returns Current world instance
 * @throws Error if world not initialized
 */
export function getWorld(): ReturnType<typeof createWorld> {
  if (!worldInstance) {
    throw new Error(
      'World not initialized. Call initializeWorld() first.',
    );
  }
  return worldInstance;
}

/**
 * Stop the world and clean up resources
 */
export async function stopWorld(): Promise<void> {
  if (!worldInstance) {
    return;
  }

  console.log('🛑 Stopping world...');

  try {
    // Type-safe check for stop method
    const world = worldInstance as any;
    if (world && typeof world.stop === 'function') {
      await world.stop();
    }
    worldInstance = null;
    console.log('✅ World stopped successfully');
  } catch (error) {
    console.error('❌ Error stopping world:', error);
    throw error;
  }
}

/**
 * Mask sensitive information in connection string for logging
 *
 * @param connectionString - PostgreSQL connection string
 * @returns Masked connection string
 *
 * @example
 * Input:  "postgres://user:secret@host:5432/db"
 * Output: "postgres://user:****@host:5432/db"
 */
function maskConnectionString(connectionString: string): string {
  return connectionString.replace(
    /(:\/\/[^:]+:)([^@]+)(@)/,
    '$1****$3',
  );
}

/**
 * Health check for the world
 * Verifies that the world is initialized and running
 *
 * @returns true if world is healthy, false otherwise
 */
export function isWorldHealthy(): boolean {
  return worldInstance !== null;
}
