# PostgreSQL World + Claude Code Provider

Production-grade, durable AI workflows using PostgreSQL-backed state persistence and the Claude Code provider.

## 🎯 Overview

This example demonstrates how to build **production-ready AI workflows** that survive server restarts, handle failures gracefully, and scale horizontally using PostgreSQL as the durable backend.

### Why PostgreSQL World?

Traditional in-memory workflows lose state when your application restarts. PostgreSQL World provides:

- ✅ **Durable State Persistence** - All workflow state stored in PostgreSQL
- ✅ **Automatic Retries** - Transient failures handled by pg-boss
- ✅ **Horizontal Scaling** - Run multiple workers for high throughput
- ✅ **Real-time Streaming** - PostgreSQL NOTIFY/LISTEN for events
- ✅ **Full Observability** - Query workflow state directly in SQL
- ✅ **Production-ready** - Battle-tested job processing with pg-boss

### Use Cases

- **Long-running AI workflows** (hours to days)
- **Multi-agent systems** with coordination
- **Background job processing** with retry logic
- **Workflows that must survive restarts**
- **Production applications** requiring durability

## 📋 Prerequisites

### 1. PostgreSQL Database

You need a PostgreSQL database (version 12+). Options:

**Local Development:**
```bash
# Using Docker
docker run -d \
  --name workflow-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=workflow_dev \
  -p 5432:5432 \
  postgres:16-alpine

# Or using Homebrew (macOS)
brew install postgresql@16
brew services start postgresql@16
createdb workflow_dev
```

**Cloud Providers:**
- [Supabase](https://supabase.com/) - Free tier available
- [Neon](https://neon.tech/) - Serverless PostgreSQL
- [Railway](https://railway.app/) - Easy deployment
- [Render](https://render.com/) - Managed PostgreSQL
- AWS RDS, Google Cloud SQL, Azure Database

### 2. Claude Code Authentication

Authenticate via Claude CLI:

```bash
# Authenticate (opens browser)
claude login

# Verify authentication
claude status
```

### 3. Node.js & Dependencies

```bash
# From project root
npm install

# The following packages are already installed:
# - @workflow/world-postgres
# - workflow
# - dotenv
# - tsx
```

## 🚀 Quick Start

### Step 1: Configure Environment

```bash
cd examples/postgres-world

# Copy environment template
cp .env.example .env

# Edit .env with your PostgreSQL connection string
nano .env
```

**Required environment variables:**

```bash
# PostgreSQL connection string
WORKFLOW_POSTGRES_URL="postgres://postgres:password@localhost:5432/workflow_dev"

# Optional: Workflow configuration
WORKFLOW_TARGET_WORLD="@workflow/world-postgres"
WORKFLOW_POSTGRES_JOB_PREFIX="workflow_"
WORKFLOW_POSTGRES_WORKER_CONCURRENCY=10
```

### Step 2: Initialize Database Schema

The PostgreSQL World requires specific tables for workflow state management:

```bash
# Option 1: Use the setup script (recommended)
npm run postgres-world:setup

# Option 2: Use the official CLI tool
npx workflow-postgres-setup

# Option 3: Manual SQL setup (see documentation)
# https://useworkflow.dev/docs/deploying/world/postgres-world
```

**Created tables:**
- `workflow_runs` - Workflow execution state
- `workflow_events` - Workflow events
- `workflow_steps` - Workflow step state
- `workflow_hooks` - Workflow hooks
- `workflow_stream_chunks` - Streaming data
- `pgboss.*` - pg-boss job queue tables

### Step 3: Run Examples

```bash
# From project root

# Run default example (content analysis)
npm run example:postgres-world

# Or run specific examples
npm run example:postgres-world:content   # Content analysis workflow
npm run example:postgres-world:research  # Multi-agent research workflow
npm run example:postgres-world:both      # Run both examples
```

## 📚 Examples Included

### 1. Content Analysis Workflow

**File:** `workflow-example.ts` → `contentAnalysisWorkflow()`

A 4-step workflow demonstrating state persistence:

1. **Sentiment Analysis** - Analyze content sentiment with Claude
2. **Processing Delay** - Simulate async waiting (survives restarts)
3. **Topic Extraction** - Extract key topics from content
4. **Report Generation** - Create comprehensive report with streaming

**Features:**
- ✅ Automatic retry on each step
- ✅ State persisted in PostgreSQL
- ✅ Can be interrupted and resumed
- ✅ Streaming output for real-time feedback

**Usage:**
```typescript
const result = await contentAnalysisWorkflow(sampleContent);
console.log(result.sentiment, result.topics, result.report);
```

### 2. Multi-Agent Research Workflow

**File:** `workflow-example.ts` → `multiAgentResearchWorkflow()`

Demonstrates parallel processing with multiple AI agents:

1. **Parallel Research** - 3 specialized agents run concurrently:
   - Technical analysis agent
   - Business impact agent
   - Ethical considerations agent
2. **Synthesis** - Coordinator agent combines findings

**Features:**
- ✅ Parallel execution with `Promise.all()`
- ✅ Each agent operates independently
- ✅ Coordinator synthesizes results
- ✅ Full durability for complex workflows

**Usage:**
```typescript
const result = await multiAgentResearchWorkflow('Quantum Computing');
console.log(result.findings, result.synthesis);
```

## 🏗️ Architecture

### File Structure

```text
examples/postgres-world/
├── README.md              # This file
├── .env.example           # Environment template
├── index.ts               # Main entry point
├── world-config.ts        # World initialization & configuration
├── workflow-example.ts    # Example workflows
└── setup-db.ts           # Database setup script
```

### Data Flow

```text
┌─────────────────────────────────────────────────────────────┐
│                     Your Application                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Workflow Execution (workflow-example.ts)            │   │
│  │  • contentAnalysisWorkflow()                         │   │
│  │  • multiAgentResearchWorkflow()                      │   │
│  └──────────────────┬──────────────────────────────────┘   │
│                     │                                        │
│  ┌──────────────────▼──────────────────────────────────┐   │
│  │  World Configuration (world-config.ts)               │   │
│  │  • initializeWorld()                                 │   │
│  │  • PostgreSQL World instance                         │   │
│  └──────────────────┬──────────────────────────────────┘   │
└────────────────────┼────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                PostgreSQL World (@workflow/world-postgres)   │
│  ┌─────────────────┐     ┌─────────────────────────────┐   │
│  │   pg-boss       │     │  PostgreSQL Tables          │   │
│  │  Job Queue      │────▶│  • workflow_runs            │   │
│  │  • Retry logic  │     │  • workflow_events          │   │
│  │  • Concurrency  │     │  • workflow_steps           │   │
│  └─────────────────┘     │  • workflow_hooks           │   │
│                           │  • workflow_stream_chunks   │   │
│  ┌─────────────────────┐ └─────────────────────────────┘   │
│  │  Event Streaming    │                                    │
│  │  NOTIFY/LISTEN      │                                    │
│  └─────────────────────┘                                    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    Claude Code Provider                      │
│  • AI SDK interface                                          │
│  • Claude Agent SDK integration                              │
│  • Uses claude login authentication                          │
└──────────────────────────────────────────────────────────────┘
```

### State Persistence

When a workflow executes:

1. **Workflow starts** → Record created in `workflow_runs`
2. **Each step executes** → State saved in `workflow_steps`
3. **Events occur** → Logged to `workflow_events`
4. **Streaming data** → Chunks saved to `workflow_stream_chunks`
5. **Workflow completes/fails** → Final state persisted

**Benefits:**
- Query workflow state with SQL
- Resume interrupted workflows
- Replay failed steps
- Audit trail of all events

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `WORKFLOW_POSTGRES_URL` | PostgreSQL connection string | `postgres://postgres:postgres@localhost:5432/workflow_dev` | ✅ Yes |
| `WORKFLOW_TARGET_WORLD` | Target world implementation | `@workflow/world-postgres` | No |
| `WORKFLOW_POSTGRES_JOB_PREFIX` | Prefix for job names | `workflow_` | No |
| `WORKFLOW_POSTGRES_WORKER_CONCURRENCY` | Number of concurrent workers | `10` | No |

### World Configuration

**File:** `world-config.ts`

```typescript
// Initialize with custom configuration
const world = await initializeWorld({
  connectionString: 'postgres://...',
  jobPrefix: 'my_app_',
  queueConcurrency: 20,
  verbose: true,
});

// Get current world instance
const world = getWorld();

// Check health
const healthy = isWorldHealthy();

// Graceful shutdown
await stopWorld();
```

### Claude Code Provider Configuration

```typescript
import { claudeCode } from '../../src/index.js';

// Basic usage
const model = claudeCode('sonnet');

// With verbose logging
const model = claudeCode('sonnet', {
  verbose: true,
});

// With custom system prompt
const model = claudeCode('sonnet', {
  systemPrompt: 'You are a specialized research assistant...',
});
```

## 🧪 Testing & Development

### Local Development

```bash
# Start PostgreSQL (Docker)
docker-compose up -d postgres

# Initialize database
npm run postgres-world:setup

# Run example in watch mode
npm run dev &
npm run example:postgres-world

# View logs
docker-compose logs -f postgres
```

### Debugging

**Enable verbose mode:**

```typescript
// In world-config.ts
const world = await initializeWorld({
  verbose: true,
});

// In workflow-example.ts
const model = claudeCode('sonnet', {
  verbose: true,
});
```

**Check PostgreSQL logs:**

```bash
# Docker
docker logs workflow-postgres -f

# Homebrew
tail -f /opt/homebrew/var/log/postgres.log
```

**Query workflow state:**

```sql
-- Active workflows
SELECT * FROM workflow_runs WHERE status = 'running';

-- Failed workflows
SELECT * FROM workflow_runs WHERE status = 'failed';

-- Recent events
SELECT * FROM workflow_events
ORDER BY created_at DESC
LIMIT 100;

-- Step execution times
SELECT
  step_name,
  AVG(completed_at - started_at) as avg_duration
FROM workflow_steps
WHERE completed_at IS NOT NULL
GROUP BY step_name;
```

## 🐛 Troubleshooting

### Connection Errors

**Error:** `connection refused` or `ECONNREFUSED`

**Solutions:**
1. Verify PostgreSQL is running:
   ```bash
   docker ps | grep postgres
   # or
   pg_isready -h localhost -p 5432
   ```

2. Check connection string format:
   ```text
   postgres://username:password@host:port/database
   ```

3. Test connection:
   ```bash
   psql "$WORKFLOW_POSTGRES_URL" -c "SELECT version();"
   ```

### Authentication Errors

**Error:** `not authenticated` with Claude Code

**Solutions:**
1. Authenticate:
   ```bash
   claude login
   ```

2. Verify:
   ```bash
   claude status
   ```

3. Re-authenticate if expired:
   ```bash
   claude logout
   claude login
   ```

### Schema Not Found

**Error:** `relation "workflow_runs" does not exist`

**Solutions:**
1. Run database setup:
   ```bash
   npm run postgres-world:setup
   ```

2. Or manually:
   ```bash
   npx workflow-postgres-setup
   ```

3. Verify tables created:
   ```bash
   psql "$WORKFLOW_POSTGRES_URL" -c "\dt workflow_*"
   ```

### Worker Issues

**Error:** Workers not processing jobs

**Solutions:**
1. Check worker configuration:
   ```bash
   echo $WORKFLOW_POSTGRES_WORKER_CONCURRENCY
   ```

2. Verify world started:
   ```typescript
   console.log('World healthy:', isWorldHealthy());
   ```

3. Check pg-boss queue:
   ```sql
   SELECT * FROM pgboss.job WHERE state = 'created';
   ```

## 📖 Additional Resources

### Documentation

- **Workflow DevKit:** https://useworkflow.dev
- **PostgreSQL World:** https://useworkflow.dev/docs/deploying/world/postgres-world
- **Claude Code Provider:** ../../README.md
- **AI SDK:** https://sdk.vercel.ai/docs

### Related Examples

- `../workflow-durable-ai.ts` - Basic workflow usage
- `../basic-usage.ts` - Claude Code provider basics
- `../streaming.ts` - Streaming responses
- `../tool-management.ts` - Tool permissions

### Community

- **GitHub Issues:** https://github.com/ben-vargas/ai-sdk-provider-claude-code/issues
- **Discussions:** https://github.com/ben-vargas/ai-sdk-provider-claude-code/discussions
- **Workflow DevKit:** https://useworkflow.dev/community

## 🚀 Production Deployment

### Deployment Checklist

- [ ] PostgreSQL database provisioned (production-grade)
- [ ] Database schema initialized
- [ ] Connection pooling configured (e.g., PgBouncer)
- [ ] Environment variables secured (use secrets manager)
- [ ] Worker concurrency tuned for workload
- [ ] Monitoring and alerting set up
- [ ] Backup strategy implemented
- [ ] Error tracking configured (e.g., Sentry)

### Scaling Considerations

**Horizontal Scaling:**
```bash
# Run multiple worker instances
WORKFLOW_POSTGRES_WORKER_CONCURRENCY=5 node index.js &
WORKFLOW_POSTGRES_WORKER_CONCURRENCY=5 node index.js &
WORKFLOW_POSTGRES_WORKER_CONCURRENCY=5 node index.js &
```

**Database Performance:**
- Use connection pooling (PgBouncer, pgpool)
- Index frequently queried columns
- Partition large tables (workflow_events)
- Regular VACUUM and ANALYZE

**Monitoring:**
```sql
-- Monitor queue depth
SELECT COUNT(*) FROM pgboss.job WHERE state = 'created';

-- Check worker performance
SELECT
  COUNT(*) as jobs_completed,
  AVG(completedOn - startedOn) as avg_duration
FROM pgboss.job
WHERE state = 'completed'
AND completedOn > NOW() - INTERVAL '1 hour';
```

## 📝 License

This example is part of the `ai-sdk-provider-claude-code` project.

**MIT License** - see LICENSE file in project root.

---

**Questions or Issues?**

Open an issue on [GitHub](https://github.com/ben-vargas/ai-sdk-provider-claude-code/issues) or check the [documentation](https://github.com/ben-vargas/ai-sdk-provider-claude-code).
