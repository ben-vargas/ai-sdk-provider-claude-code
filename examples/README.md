# Claude Code AI SDK Provider Examples

This directory contains curated examples demonstrating the most important features of the Claude Code AI SDK Provider. Each example serves a specific purpose and demonstrates a key pattern or capability.

> **Note**: These examples are written for Vercel AI SDK v5. If you're using AI SDK v4, please refer to the v4 branch.

## Prerequisites

1. Install and authenticate Claude CLI:

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

### 3. Tool Streaming (`tool-streaming.ts`)

**Purpose**: Observe tool-call events emitted by the provider while Claude Code executes built-in tools.

```bash
npx tsx examples/tool-streaming.ts
```

**Key concepts**: Tool streaming, provider-executed tools, detailed stream inspection

### 4. Images (`images.ts`)

**Purpose**: Stream a prompt that includes a local image (PNG/JPG/GIF/WebP).

```bash
npx tsx examples/images.ts /absolute/path/to/image.png
```

**Key concepts**: Image data URLs, streaming prerequisite, multimodal prompts

### 5. Conversation History (`conversation-history.ts`)

**Purpose**: Show the correct way to maintain context across multiple messages.

```bash
npx tsx examples/conversation-history.ts
```

**Key concepts**: Message history pattern, context preservation, multi-turn conversations

## Logging Examples

The provider includes a flexible logging system that can be configured for different use cases. These examples demonstrate all logging modes:

### 6. Default Logging (`logging-default.ts`)

**Purpose**: Understand the default logging behavior (non-verbose mode).

```bash
npx tsx examples/logging-default.ts
```

**Key concepts**: Default behavior, warn/error only, clean output

**What you'll see**: Only warning and error messages appear. Debug and info logs are suppressed for clean output.

### 7. Verbose Logging (`logging-verbose.ts`)

**Purpose**: Enable detailed logging for development and troubleshooting.

```bash
npx tsx examples/logging-verbose.ts
```

**Key concepts**: Verbose mode, debug/info logs, execution tracing

**What you'll see**: All log levels (debug, info, warn, error) showing detailed provider activity.

### 8. Custom Logger (`logging-custom-logger.ts`)

**Purpose**: Integrate with external logging systems (Winston, Pino, Datadog, etc.).

```bash
npx tsx examples/logging-custom-logger.ts
```

**Key concepts**: Custom logger implementation, external integration, log formatting

**What you'll see**: Custom-formatted logs with timestamps and prefixes, demonstrating integration patterns.

### 9. Disabled Logging (`logging-disabled.ts`)

**Purpose**: Completely silent operation with no logs.

```bash
npx tsx examples/logging-disabled.ts
```

**Key concepts**: Silent mode, production deployments, zero output

**What you'll see**: No provider logs at all - completely silent operation.

## Advanced Configuration

### 10. Custom Config (`custom-config.ts`)

**Purpose**: Demonstrate provider and model configuration options.

```bash
npx tsx examples/custom-config.ts
```

**Key concepts**: Provider settings, model overrides, tool restrictions, permission modes

### 11. Tool Management (`tool-management.ts`)

**Purpose**: Show fine-grained control over Claude's tool access for security.

```bash
npx tsx examples/tool-management.ts
```

**Key concepts**: Allow/deny lists, tool security, MCP server tools, built-in tools

### 12. Long-Running Tasks (`long-running-tasks.ts`)

**Purpose**: Handle timeouts properly using AI SDK's AbortSignal pattern.

```bash
npx tsx examples/long-running-tasks.ts
```

**Key concepts**: Custom timeouts, graceful cancellation, retry logic

### 13. Abort Signal (`abort-signal.ts`)

**Purpose**: Implement user-initiated cancellations and cleanup.

```bash
npx tsx examples/abort-signal.ts
```

**Key concepts**: Request cancellation, resource cleanup, user controls

### 14. Hooks & Callbacks (`hooks-callbacks.ts`)

**Purpose**: Use lifecycle hooks and dynamic permission callbacks.

```bash
npx tsx examples/hooks-callbacks.ts
```

**Key concepts**: PreToolUse/PostToolUse hooks, canUseTool callback, permission control, event lifecycle

### 15. SDK Tools (`sdk-tools-callbacks.ts`)

**Purpose**: Define and use in-process MCP tools with the Agent SDK.

```bash
npx tsx examples/sdk-tools-callbacks.ts
```

**Key concepts**: In-process tools, createSdkMcpServer, tool definitions, MCP integration

## Object Generation (Structured Output)

### 16. Object Generation Overview (`generate-object.ts`)

**Purpose**: Advanced real-world examples of object generation.

```bash
npx tsx examples/generate-object.ts
```

**Key concepts**: Complex schemas, product analysis, free-form JSON, practical applications

### 17. Object Generation Tutorial (`generate-object-basic.ts`)

**Purpose**: Learn object generation step-by-step with progressively complex examples.

```bash
npx tsx examples/generate-object-basic.ts
```

**Key concepts**: Schema basics, progressive complexity, best practices, clear explanations

### 18. Nested Structures (`generate-object-nested.ts`)

**Purpose**: Generate complex, real-world data structures.

```bash
npx tsx examples/generate-object-nested.ts
```

**Key concepts**: Hierarchical data, recursive schemas, complex relationships

### 19. Validation Constraints (`generate-object-constraints.ts`)

**Purpose**: Enforce data quality with advanced validation rules.

```bash
npx tsx examples/generate-object-constraints.ts
```

**Key concepts**: Enums, number ranges, string patterns, business rules

## Testing & Troubleshooting

### 20. Integration Test (`integration-test.ts`)

**Purpose**: Comprehensive test suite to verify your setup and all features.

```bash
npx tsx examples/integration-test.ts
```

**Key concepts**: Feature verification, error handling, test patterns

### 21. Check CLI (`check-cli.ts`)

**Purpose**: Troubleshooting tool to verify CLI installation and authentication.

```bash
npx tsx examples/check-cli.ts
```

**Key concepts**: Setup verification, error diagnosis, troubleshooting steps

### 22. Limitations (`limitations.ts`)

**Purpose**: Understand what AI SDK features are not supported by the CLI.

```bash
npx tsx examples/limitations.ts
```

**Key concepts**: Unsupported parameters, workarounds, provider constraints

## Common Patterns

### Object Generation

```typescript
import { generateObject } from 'ai';
import { z } from 'zod';

const { object } = await generateObject({
  model: claudeCode('haiku'),
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
  { role: 'user', content: 'What did I just tell you?' },
];

const { text } = await generateText({
  model: claudeCode('haiku'),
  messages,
});
```

### Streaming Responses

```typescript
import { streamText } from 'ai';

const result = streamText({
  model: claudeCode('haiku'),
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
    model: claudeCode('haiku'),
    prompt: 'Complex analysis...',
    abortSignal: controller.signal,
  });
  clearTimeout(timeoutId);
} catch (error) {
  // Handle timeout
}
```

### Logging Configuration

```typescript
import type { Logger } from '../dist/index.js';

// Default: warn and error only
const result1 = streamText({
  model: claudeCode('haiku'),
  prompt: 'Hello',
});

// Verbose: all log levels
const result2 = streamText({
  model: claudeCode('haiku', { verbose: true }),
  prompt: 'Hello',
});

// Custom logger
const customLogger: Logger = {
  debug: (msg) => myLogger.debug(msg),
  info: (msg) => myLogger.info(msg),
  warn: (msg) => myLogger.warn(msg),
  error: (msg) => myLogger.error(msg),
};

const result3 = streamText({
  model: claudeCode('haiku', {
    verbose: true,
    logger: customLogger,
  }),
  prompt: 'Hello',
});

// Disable all logging
const result4 = streamText({
  model: claudeCode('haiku', { logger: false }),
  prompt: 'Hello',
});
```

## Quick Reference

| Example               | Primary Use Case      | Key Feature            |
| --------------------- | --------------------- | ---------------------- |
| basic-usage           | Getting started       | Simple text generation |
| streaming             | Responsive UIs        | Real-time output       |
| tool-streaming        | Tool observability    | Tool event inspection  |
| images                | Multimodal prompts    | Image input support    |
| conversation-history  | Chatbots              | Context preservation   |
| logging-default       | Default behavior      | Warn/error only        |
| logging-verbose       | Development/debugging | All log levels         |
| logging-custom-logger | External integration  | Custom logger impl     |
| logging-disabled      | Silent operation      | No logs at all         |
| custom-config         | Enterprise setup      | Configuration options  |
| tool-management       | Security              | Access control         |
| hooks-callbacks       | Event handling        | Lifecycle hooks        |
| sdk-tools-callbacks   | Custom tools          | In-process MCP tools   |
| long-running-tasks    | Complex reasoning     | Timeout handling       |
| generate-object       | Advanced patterns     | Real-world schemas     |
| generate-object-basic | Learning              | Step-by-step tutorial  |

## Learning Path

1. **Beginners**: Start with `basic-usage.ts` → `streaming.ts` → `conversation-history.ts`
2. **Images & Tools**: `images.ts` → `tool-streaming.ts` to understand multimodal inputs and tool events
3. **Logging**: `logging-default.ts` → `logging-verbose.ts` → `logging-custom-logger.ts` → `logging-disabled.ts`
4. **Object Generation**: `generate-object-basic.ts` → `generate-object-nested.ts` → `generate-object-constraints.ts` → `generate-object.ts`
5. **Advanced**: `custom-config.ts` → `tool-management.ts` → `hooks-callbacks.ts` → `sdk-tools-callbacks.ts` → `long-running-tasks.ts`
6. **Testing**: Run `integration-test.ts` to verify everything works

For more details, see the main [README](../README.md).
