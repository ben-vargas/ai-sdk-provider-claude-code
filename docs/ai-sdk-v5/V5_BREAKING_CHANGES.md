# Breaking Changes: V4 to V5 Migration

This document outlines the breaking changes users will encounter when upgrading from v4 to v5 of the ai-sdk-provider-claude-code.

⚠️ **IMPORTANT**: This is a complete breaking change. The v5 version of this provider ONLY works with AI SDK v5. You cannot use:

- v5 provider with AI SDK v4 ❌
- v4 provider with AI SDK v5 ❌

You must upgrade both together.

## Installation

Update your dependencies to use the beta versions:

```json
{
  "dependencies": {
    "ai": "beta",
    "ai-sdk-provider-claude-code": "latest"
  }
}
```

## API Changes

### 1. Token Usage Properties

The token usage properties have been renamed:

```typescript
// V4
const { usage } = await generateText(...);
console.log(usage.promptTokens);    // ❌ Old
console.log(usage.completionTokens); // ❌ Old

// V5
const { usage } = await generateText(...);
console.log(usage.inputTokens);     // ✅ New
console.log(usage.outputTokens);    // ✅ New
console.log(usage.totalTokens);     // ✅ New
```

### 2. Streaming Response Pattern

The streamText function now returns a result object with promises:

```typescript
// V4
const { text, usage } = await streamText({
  model: claudeCode('opus'),
  prompt: 'Hello',
});

// V5
const result = streamText({
  model: claudeCode('opus'),
  prompt: 'Hello',
});
const text = await result.text;
const usage = await result.usage;
```

### 3. Message Types

In v5, messages sent to the model should use `ModelMessage` type:

```typescript
// V4
import type { Message } from 'ai';
const messages: Message[] = [];

// V5
import type { ModelMessage } from 'ai';
const messages: ModelMessage[] = [];
```

**Note**: `UIMessage` is for UI state management, while `ModelMessage` is for sending to language models.

### 4. Parameter Names

Some parameter names have changed:

```typescript
// V4
generateText({
  model: claudeCode('opus'),
  prompt: 'Hello',
  maxTokens: 100, // ❌ Old
});

// V5
generateText({
  model: claudeCode('opus'),
  prompt: 'Hello',
  maxOutputTokens: 100, // ✅ New
});
```

### 5. Stream Events

V5 streams now emit additional events:

```typescript
// V5 stream includes these events:
// - stream-start (with warnings)
// - response-metadata
// - text-delta (with 'delta' property, not 'textDelta')
// - finish
```

## Code Examples

### Basic Text Generation

```typescript
// V5 Pattern
import { streamText } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';

const result = streamText({
  model: claudeCode('opus'),
  prompt: 'Write a haiku',
});

// Await the results
const text = await result.text;
const usage = await result.usage;
const metadata = await result.providerMetadata;
```

### Conversation with History

```typescript
// V5 Pattern
import { streamText } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';
import type { CoreMessage } from 'ai';

const messages: CoreMessage[] = [
  { role: 'user', content: 'Hello!' },
  { role: 'assistant', content: 'Hi there!' },
  { role: 'user', content: 'How are you?' },
];

const result = streamText({
  model: claudeCode('opus'),
  messages,
});

const response = await result.text;
```

## Notes

- All Claude Code SDK-specific limitations still apply (no temperature control, no output length limits, etc.)
- TypeScript users will get compile-time errors for most breaking changes
- This is a complete rewrite for v5 compatibility - no v4 compatibility is maintained
