# Workflow DevKit Integration

Integration guide for using [Anthropic's Workflow DevKit](https://useworkflow.dev) with `ai-sdk-provider-claude-code`.

## Overview

**Workflow DevKit** transforms standard async functions into durable, resumable processes. When combined with this Claude Code provider, you get:

- ✅ **Durable AI Workflows** - Long-running AI tasks that survive restarts
- ✅ **Automatic Retry Logic** - Built-in error handling for transient failures
- ✅ **State Persistence** - Workflows resume from where they stopped
- ✅ **Full Observability** - Traces, logs, and replay capability
- ✅ **Zero Configuration** - Works identically locally and in production

## Installation

```bash
npm install workflow @vercel/analytics
```

**Current versions:**
- `workflow`: 4.0.1-beta.11 (beta)
- `ai-sdk-provider-claude-code`: 2.1.0

## Basic Usage

### 1. Simple Workflow

```typescript
import { generateText } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';

export async function aiResearchWorkflow(topic: string) {
  'use workflow'; // ← Enables durability

  const model = claudeCode('sonnet');

  // Step 1: Initial research
  const research = await performResearch(topic);

  // Step 2: Wait (can suspend here)
  await sleep('5 minutes');

  // Step 3: Generate report
  const report = await generateReport(topic, research);

  return { topic, research, report };
}

async function performResearch(topic: string) {
  'use step'; // ← Automatic retry on failure

  const model = claudeCode('sonnet');
  const { text } = await generateText({
    model,
    prompt: `Research: ${topic}`,
  });

  return text;
}
```

### 2. Multi-Step AI Pipeline

```typescript
export async function contentCreationWorkflow(brief: string) {
  'use workflow';

  // Step 1: Generate outline
  const outline = await generateOutline(brief);

  // Step 2: Write content sections (parallel)
  const sections = await Promise.all(
    outline.sections.map((section) => writeSection(section)),
  );

  // Step 3: Review and polish
  const polished = await polishContent(sections.join('\n'));

  return { outline, sections, polished };
}
```

## Key Features

### Durable Execution

Workflows can suspend and resume at any `await` point:

```typescript
export async function longRunningWorkflow() {
  'use workflow';

  const step1 = await doStep1();
  await sleep('24 hours'); // ← Can suspend here
  const step2 = await doStep2(step1);
  await sleep('7 days'); // ← And here
  const step3 = await doStep3(step2);

  return { step1, step2, step3 };
}
```

### Error Handling

Use `'use step'` directive for automatic retries:

```typescript
async function reliableAICall(prompt: string) {
  'use step'; // ← Retries on transient failures

  const model = claudeCode('sonnet');
  const { text } = await generateText({ model, prompt });

  return text;
}
```

### Observability

Every execution is automatically tracked:

```typescript
export async function trackedWorkflow(input: string) {
  'use workflow';

  // All steps are automatically traced
  const result1 = await step1(input);
  const result2 = await step2(result1);
  const result3 = await step3(result2);

  return result3;
}

// View traces in Workflow DevKit dashboard
// - Step execution times
// - Input/output for each step
// - Errors and retries
// - Full workflow history
```

## Examples

### Example 1: Research Assistant

See `examples/workflow-durable-ai.ts` for a complete example:

```typescript
export async function researchAssistantWorkflow(topic: string) {
  'use workflow';

  const initial = await performInitialResearch(topic);
  await sleep('5 seconds'); // Human review period
  const deep = await performDeepDive(topic, initial);
  const report = await generateFinalReport(topic, initial, deep);

  return { topic, initial, deep, report };
}
```

**Features demonstrated:**
- Multi-step AI pipeline
- Workflow delays (simulate human review)
- State management across steps
- Comprehensive error handling

### Example 2: Content Generation Pipeline

```typescript
export async function contentPipeline(brief: string) {
  'use workflow';

  const keywords = await extractKeywords(brief);
  const outline = await generateOutline(brief, keywords);
  const draft = await writeDraft(outline);
  const edited = await editAndPolish(draft);

  return { keywords, outline, draft, edited };
}
```

## Configuration

### Provider Settings

Use provider configuration for workflow-specific settings:

```typescript
const model = claudeCode('sonnet', {
  verbose: true, // Enable detailed logging for workflows
  systemPrompt: 'You are a research assistant...',
  allowedTools: ['Read'], // Limit tools for workflow safety
});
```

### Retry Strategies

Workflow DevKit provides automatic retry:

```typescript
async function robustAICall(prompt: string) {
  'use step';

  try {
    const model = claudeCode('sonnet');
    const { text } = await generateText({ model, prompt });
    return text;
  } catch (error) {
    // Workflow DevKit automatically retries transient errors
    // You can add custom logic for permanent failures
    throw error;
  }
}
```

## Limitations & Known Issues

### 1. Beta Software

⚠️ Workflow DevKit is currently in beta (`4.0.1-beta.11`)

- API may change in future versions
- Some features are experimental
- Production use requires thorough testing

### 2. Framework Dependencies

The `workflow` package currently includes SvelteKit dependencies:

```text
workflow@4.0.1-beta.11
└── @workflow/sveltekit@4.0.0-beta.5
    └── @sveltejs/kit@2.48.4
```

This adds ~234 packages to your `node_modules`, which may be excessive for a provider library.

**Recommendation**: Install `workflow` as a **peer dependency** in your application, not in the provider itself.

### 3. Security Vulnerabilities

Current installation reports 4 low severity vulnerabilities:

```text
cookie <0.7.0 (via @sveltejs/kit)
```

These are in transitive dependencies and don't affect the provider code directly.

### 4. TypeScript Configuration

Some TypeScript configurations may require adjustments:

- Enable `esModuleInterop` for proper imports
- Use `--target es2015` or higher
- Enable `--downlevelIteration` if needed

## Best Practices

### 1. Workflow Granularity

**Good**: Break workflows into logical steps

```typescript
export async function goodWorkflow(input: string) {
  'use workflow';

  const step1 = await processStep1(input);
  const step2 = await processStep2(step1);
  const step3 = await processStep3(step2);

  return { step1, step2, step3 };
}
```

**Bad**: Monolithic workflows without steps

```typescript
export async function badWorkflow(input: string) {
  'use workflow';

  // All logic in one place - hard to debug/replay
  const result = await massiveProcess(input);
  return result;
}
```

### 2. Error Boundaries

Use `'use step'` for operations that may fail:

```typescript
async function safeOperation(data: string) {
  'use step'; // ← Automatic retry

  // Potentially failing operation
  const model = claudeCode('sonnet');
  return await generateText({ model, prompt: data });
}
```

### 3. Idempotency

Ensure steps are idempotent for safe retries:

```typescript
async function idempotentStep(id: string) {
  'use step';

  // Check if already processed
  const existing = await getExisting(id);
  if (existing) return existing;

  // Process only if needed
  const result = await process(id);
  await save(id, result);

  return result;
}
```

### 4. Timeout Management

Set appropriate timeouts for long-running operations:

```typescript
async function longOperation() {
  'use step';

  const model = claudeCode('sonnet', {
    timeout: 60000, // 60 seconds
  });

  return await generateText({ model, prompt: '...' });
}
```

## Deployment

### Local Development

```bash
# Run workflow locally
npm run example:workflow
```

### Production (Vercel)

Workflow DevKit works identically on Vercel:

```typescript
// app/api/workflow/route.ts
import { workflowHandler } from 'workflow/vercel';
import { myWorkflow } from './workflows';

export const POST = workflowHandler(myWorkflow);
```

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
CMD ["node", "dist/workflows.js"]
```

## Testing

### Unit Tests

Test individual workflow steps:

```typescript
import { describe, it, expect } from 'vitest';
import { performResearch } from './workflow';

describe('performResearch', () => {
  it('should generate research text', async () => {
    const result = await performResearch('AI Safety');
    expect(result).toContain('AI Safety');
    expect(result.length).toBeGreaterThan(100);
  });
});
```

### Integration Tests

Test complete workflows:

```typescript
describe('researchWorkflow', () => {
  it('should complete full research pipeline', async () => {
    const result = await researchAssistantWorkflow('Quantum Computing');

    expect(result.topic).toBe('Quantum Computing');
    expect(result.initial).toBeDefined();
    expect(result.deep).toBeDefined();
    expect(result.report).toBeDefined();
  });
});
```

## Monitoring

Workflow DevKit provides built-in observability:

- **Traces**: View execution timeline
- **Logs**: Detailed step-by-step output
- **Metrics**: Performance statistics
- **Replay**: Re-run workflows for debugging

Access via Workflow DevKit dashboard (configuration required).

## Troubleshooting

### Issue: "Module not found: workflow"

**Solution**: Install the workflow package

```bash
npm install workflow
```

### Issue: TypeScript errors with imports

**Solution**: Update `tsconfig.json`

```json
{
  "compilerOptions": {
    "esModuleInterop": true,
    "target": "ES2020",
    "downlevelIteration": true
  }
}
```

### Issue: Workflows not suspending

**Solution**: Ensure `'use workflow'` directive is present

```typescript
export async function myWorkflow() {
  'use workflow'; // ← Required
  // ...
}
```

### Issue: Steps not retrying on failure

**Solution**: Add `'use step'` directive

```typescript
async function myStep() {
  'use step'; // ← Required for auto-retry
  // ...
}
```

## Resources

- **Workflow DevKit**: https://useworkflow.dev
- **Documentation**: https://useworkflow.dev/docs
- **Examples**: `examples/workflow-durable-ai.ts`
- **AI SDK**: https://sdk.vercel.ai
- **Claude Code Provider**: This repository

## Migration Guide

### From Standard Async Functions

**Before:**

```typescript
async function processData(input: string) {
  const step1 = await doStep1(input);
  const step2 = await doStep2(step1);
  return step2;
}
```

**After:**

```typescript
async function processData(input: string) {
  'use workflow'; // ← Add directive

  const step1 = await doStep1(input);
  const step2 = await doStep2(step1);
  return step2;
}

// Make steps retriable
async function doStep1(input: string) {
  'use step'; // ← Add directive
  // ... existing code
}
```

## Changelog

### 2025-11-06

- Added Workflow DevKit integration
- Created example: `workflow-durable-ai.ts`
- Documented best practices and limitations
- Added troubleshooting guide

---

**Note**: This integration is experimental. Test thoroughly before production use. Workflow DevKit is currently in beta and APIs may change.

For questions or issues, please file an issue on GitHub.
