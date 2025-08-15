# Claude Code AI SDK Provider Examples

This directory contains curated examples demonstrating the most important features of the Claude Code AI SDK Provider. Each example serves a specific purpose and demonstrates a key pattern or capability.

> **Note**: These examples are written for Vercel AI SDK v5. If you're using AI SDK v4, please refer to the v4 branch.

## Prerequisites

1. Install and authenticate Claude Code SDK:
```bash
npm install -g @anthropic-ai/claude-code
claude login
```

2. Build the provider:
```bash
npm run build
```

3. Verify your setup:
```bash
npx tsx examples/check-cli.ts
```

## Quick Start Examples

### 1. Basic Usage (`basic-usage.ts`)
**Purpose**: The simplest possible example - generate text with Claude and display metadata.
```bash
npx tsx examples/basic-usage.ts
```
**Key concepts**: Text generation, token usage, provider metadata (cost, duration)

### 2. Streaming (`streaming.ts`)
**Purpose**: Demonstrate real-time streaming for responsive user experiences.
```bash
npx tsx examples/streaming.ts
```
**Key concepts**: Stream processing, chunk handling, real-time output

### 3. Conversation History (`conversation-history.ts`)
**Purpose**: Show the correct way to maintain context across multiple messages.
```bash
npx tsx examples/conversation-history.ts
```
**Key concepts**: Message history pattern, context preservation, multi-turn conversations

## Advanced Configuration

### 4. Custom Config (`custom-config.ts`)
**Purpose**: Demonstrate provider and model configuration options.
```bash
npx tsx examples/custom-config.ts
```
**Key concepts**: Provider settings, model overrides, tool restrictions, permission modes

### 5. Tool Management (`tool-management.ts`)
**Purpose**: Show fine-grained control over Claude's tool access for security.
```bash
npx tsx examples/tool-management.ts
```
**Key concepts**: Allow/deny lists, tool security, MCP server tools, built-in tools

### 6. Long-Running Tasks (`long-running-tasks.ts`)
**Purpose**: Handle timeouts properly using AI SDK's AbortSignal pattern.
```bash
npx tsx examples/long-running-tasks.ts
```
**Key concepts**: Custom timeouts, graceful cancellation, retry logic, Opus 4's extended thinking

### 7. Abort Signal (`abort-signal.ts`)
**Purpose**: Implement user-initiated cancellations and cleanup.
```bash
npx tsx examples/abort-signal.ts
```
**Key concepts**: Request cancellation, resource cleanup, user controls

## Object Generation (Structured Output)

### 8. Object Generation Overview (`generate-object.ts`)
**Purpose**: Advanced real-world examples of object generation.
```bash
npx tsx examples/generate-object.ts
```
**Key concepts**: Complex schemas, product analysis, free-form JSON, practical applications

### 9. Object Generation Tutorial (`generate-object-basic.ts`)
**Purpose**: Learn object generation step-by-step with progressively complex examples.
```bash
npx tsx examples/generate-object-basic.ts
```
**Key concepts**: Schema basics, progressive complexity, best practices, clear explanations

### 10. Nested Structures (`generate-object-nested.ts`)
**Purpose**: Generate complex, real-world data structures.
```bash
npx tsx examples/generate-object-nested.ts
```
**Key concepts**: Hierarchical data, recursive schemas, complex relationships

### 11. Validation Constraints (`generate-object-constraints.ts`)
**Purpose**: Enforce data quality with advanced validation rules.
```bash
npx tsx examples/generate-object-constraints.ts
```
**Key concepts**: Enums, number ranges, string patterns, business rules

## Testing & Troubleshooting

### 12. Integration Test (`integration-test.ts`)
**Purpose**: Comprehensive test suite to verify your setup and all features.
```bash
npx tsx examples/integration-test.ts
```
**Key concepts**: Feature verification, error handling, test patterns

### 13. Check CLI (`check-cli.ts`)
**Purpose**: Troubleshooting tool to verify CLI installation and authentication.
```bash
npx tsx examples/check-cli.ts
```
**Key concepts**: Setup verification, error diagnosis, troubleshooting steps

### 14. Limitations (`limitations.ts`)
**Purpose**: Understand what AI SDK features are not supported by the CLI.
```bash
npx tsx examples/limitations.ts
```
**Key concepts**: Unsupported parameters, workarounds, provider constraints

### 15. Session Test (`test-session.ts`)
**Purpose**: Demonstrates message history pattern with comparison to sessionless approach.
```bash
npx tsx examples/test-session.ts
```
**Key concepts**: Context retention, history vs no-history comparison, conversation patterns

## Common Patterns

### Object Generation
```typescript
import { generateObject } from 'ai';
import { z } from 'zod';

const { object } = await generateObject({
  model: claudeCode('sonnet'),
  schema: z.object({
    name: z.string(),
    age: z.number(),
    email: z.string().email(),
  }),
  prompt: 'Generate a random user profile',
});
```

### Error Handling
```typescript
import { isAuthenticationError } from '../dist/index.js';

try {
  // Your code here
} catch (error) {
  if (isAuthenticationError(error)) {
    console.error('Please run: claude login');
  }
}
```

### Message History for Conversations
```typescript
import type { ModelMessage } from 'ai';

const messages: ModelMessage[] = [
  { role: 'user', content: 'Hello, my name is Alice' },
  { role: 'assistant', content: 'Nice to meet you, Alice!' },
  { role: 'user', content: 'What did I just tell you?' }
];

const { text } = await generateText({
  model: claudeCode('sonnet'),
  messages,
});
```

### Streaming Responses
```typescript
import { streamText } from 'ai';

const result = streamText({
  model: claudeCode('sonnet'),
  prompt: 'Write a story...',
});

// Stream the response in real-time
for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

### Custom Timeouts
```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes

try {
  const { text } = await generateText({
    model: claudeCode('opus'),
    prompt: 'Complex analysis...',
    abortSignal: controller.signal,
  });
  clearTimeout(timeoutId);
} catch (error) {
  // Handle timeout
}
```

## Quick Reference

| Example | Primary Use Case | Key Feature |
|---------|-----------------|-------------|
| basic-usage | Getting started | Simple text generation |
| streaming | Responsive UIs | Real-time output |
| conversation-history | Chatbots | Context preservation |
| custom-config | Enterprise setup | Configuration options |
| tool-management | Security | Access control |
| long-running-tasks | Complex reasoning | Timeout handling |
| generate-object | Advanced patterns | Real-world schemas |
| generate-object-basic | Learning | Step-by-step tutorial |

## Learning Path

1. **Beginners**: Start with `basic-usage.ts` → `streaming.ts` → `conversation-history.ts`
2. **Object Generation**: `generate-object-basic.ts` → `generate-object-nested.ts` → `generate-object-constraints.ts` → `generate-object.ts`
3. **Advanced**: `custom-config.ts` → `tool-management.ts` → `long-running-tasks.ts`
4. **Testing**: Run `integration-test.ts` to verify everything works

For more details, see the main [README](../README.md).