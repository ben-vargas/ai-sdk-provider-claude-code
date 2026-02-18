# Usage Guide

## Essential Examples

### Streaming Responses

```typescript
import { streamText } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';

const result = await streamText({
  model: claudeCode('sonnet'),
  prompt: 'Write a haiku about programming',
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

### Multi-turn Conversations

```typescript
import { generateText } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';

const messages = [];

// First turn
messages.push({ role: 'user', content: 'My name is Alice' });
const { text: response1 } = await generateText({
  model: claudeCode('sonnet'),
  messages,
});
messages.push({ role: 'assistant', content: response1 });

// Second turn - remembers context
messages.push({ role: 'user', content: 'What is my name?' });
const { text: response2 } = await generateText({
  model: claudeCode('sonnet'),
  messages,
});
console.log(response2); // "Alice"
```

### Object Generation with JSON Schema

```typescript
import { generateObject } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';
import { z } from 'zod';

const { object } = await generateObject({
  model: claudeCode('sonnet'),
  schema: z.object({
    name: z.string().describe('Full name'),
    age: z.number().describe('Age in years'),
    email: z.string().email().describe('Email address'),
    interests: z.array(z.string()).describe('List of hobbies'),
  }),
  prompt: 'Generate a profile for a software developer',
});

console.log(object);
// {
//   name: "Alex Chen",
//   age: 28,
//   email: "alex.chen@example.com",
//   interests: ["coding", "open source", "machine learning"]
// }
```

### Handling Long-Running Tasks

For complex tasks with Claude Opus 4's extended thinking, use AbortSignal with custom timeouts:

```typescript
import { generateText } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';

// Create a custom timeout
const controller = new AbortController();
const timeoutId = setTimeout(() => {
  controller.abort(new Error('Request timeout after 10 minutes'));
}, 600000); // 10 minutes

try {
  const { text } = await generateText({
    model: claudeCode('opus'),
    prompt: 'Analyze this complex problem in detail...',
    abortSignal: controller.signal,
  });

  clearTimeout(timeoutId);
  console.log(text);
} catch (error) {
  if (error.name === 'AbortError') {
    console.log('Request was cancelled');
  }
}
```

### Session Management (Experimental)

```typescript
import { generateText } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';

// First message
const { text, providerMetadata } = await generateText({
  model: claudeCode('sonnet'),
  messages: [{ role: 'user', content: 'My name is Bob.' }],
});

// Resume using the session ID
const sessionId = providerMetadata?.['claude-code']?.sessionId;

const { text: response } = await generateText({
  model: claudeCode('sonnet', { resume: sessionId }),
  messages: [{ role: 'user', content: 'What is my name?' }],
});
```

`resume` continues a previous CLI session instead of starting a new one.

---

## Detailed Configuration

### AbortSignal Support

The provider fully supports the standard AbortSignal for request cancellation, following Vercel AI SDK patterns:

```typescript
import { generateText } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';

// Using AbortController for cancellation
const controller = new AbortController();

// Cancel after user action
button.addEventListener('click', () => {
  controller.abort();
});

const { text } = await generateText({
  model: claudeCode('opus'),
  prompt: 'Write a story...',
  abortSignal: controller.signal,
});
```

**For Long-Running Tasks**: Claude Opus 4's extended thinking may require longer timeouts than typical HTTP requests. See the "Handling Long-Running Tasks" section above for implementing custom timeouts using AbortSignal.

### Configuration Options

| Option                       | Type                 | Default     | Description                   |
| ---------------------------- | -------------------- | ----------- | ----------------------------- |
| `model`                      | `'opus' \| 'sonnet'` | `'opus'`    | Model to use                  |
| `pathToClaudeCodeExecutable` | `string`             | `'claude'`  | Path to Claude CLI executable |
| `customSystemPrompt`         | `string`             | `undefined` | Custom system prompt          |
| `appendSystemPrompt`         | `string`             | `undefined` | Append to system prompt       |
| `maxTurns`                   | `number`             | `undefined` | Maximum conversation turns    |
| `maxThinkingTokens`          | `number`             | `undefined` | Maximum thinking tokens       |
| `permissionMode`             | `string`             | `'default'` | Permission mode for tools     |
| `allowedTools`               | `string[]`           | `undefined` | Tools to explicitly allow     |
| `disallowedTools`            | `string[]`           | `undefined` | Tools to restrict             |
| `mcpServers`                 | `object`             | `undefined` | MCP server configuration      |
| `resume`                     | `string`             | `undefined` | Resume an existing session    |

### Custom Configuration

```typescript
import { createClaudeCode } from 'ai-sdk-provider-claude-code';

const claude = createClaudeCode({
  defaultSettings: {
    pathToClaudeCodeExecutable: '/usr/local/bin/claude',
    permissionMode: 'default', // Ask for permissions
    customSystemPrompt: 'You are a helpful coding assistant.',
  },
});

const { text } = await generateText({
  model: claude('opus'),
  prompt: 'Hello, Claude!',
});
```

### Logging Configuration

Control how warnings and errors are logged:

```typescript
import { createClaudeCode } from 'ai-sdk-provider-claude-code';

// Default: logs to console
const defaultClaude = createClaudeCode();

// Disable all logging
const silentClaude = createClaudeCode({
  defaultSettings: {
    logger: false,
  },
});

// Custom logger
const customClaude = createClaudeCode({
  defaultSettings: {
    logger: {
      warn: (message) => myLogger.warn('Claude:', message),
      error: (message) => myLogger.error('Claude:', message),
    },
  },
});

// Model-specific logger override
const model = customClaude('opus', {
  logger: false, // Disable logging for this model only
});
```

Logger options:

- `undefined` (default): Uses `console.warn` and `console.error`
- `false`: Disables all logging
- Custom `Logger` object: Must implement `warn` and `error` methods

### Tool Management

Control which tools Claude Code can use with either `allowedTools` (allowlist) or `disallowedTools` (denylist). These flags work for **both built-in Claude tools and MCP tools**, providing session-only permission overrides.

#### Tool Types

- **Built-in tools**: `Bash`, `Edit`, `Read`, `Write`, `LS`, `Grep`, etc.
- **MCP tools**: `mcp__serverName__toolName` format

#### Using allowedTools (Allowlist)

```typescript
import { createClaudeCode } from 'ai-sdk-provider-claude-code';

// Only allow specific built-in tools
const readOnlyClaude = createClaudeCode({
  allowedTools: ['Read', 'LS', 'Grep'],
});

// Allow specific Bash commands using specifiers
const gitOnlyClaude = createClaudeCode({
  allowedTools: ['Bash(git log:*)', 'Bash(git diff:*)', 'Bash(git status)'],
});

// Mix built-in and MCP tools
const mixedClaude = createClaudeCode({
  allowedTools: ['Read', 'Bash(npm test:*)', 'mcp__filesystem__read_text_file', 'mcp__git__status'],
});
```

#### Using disallowedTools (Denylist)

```typescript
// Block dangerous operations
const safeClaude = createClaudeCode({
  disallowedTools: ['Write', 'Edit', 'Delete', 'Bash(rm:*)', 'Bash(sudo:*)'],
});

// Block all Bash and MCP write operations
const restrictedClaude = createClaudeCode({
  disallowedTools: ['Bash', 'mcp__filesystem__write_file', 'mcp__git__commit', 'mcp__git__push'],
});
```

#### Model-Specific Overrides

```typescript
const baseClaude = createClaudeCode({
  disallowedTools: ['Write', 'Edit'],
});

// Override for a specific call
const { text } = await generateText({
  model: baseClaude('opus', {
    disallowedTools: [], // Allow everything for this call
  }),
  prompt: 'Create a simple config file...',
});
```

**Key Points**:

- These are **session-only permission overrides** (same syntax as settings.json)
- Higher priority than settings files
- Works for both built-in tools AND MCP tools
- Cannot use both `allowedTools` and `disallowedTools` together
- Empty `allowedTools: []` = Explicit empty allowlist (no tools allowed)
- Omitting the flags entirely = Falls back to normal permission system
- Use `/permissions` in Claude to see all available tool names

**Common Patterns**:

- Read-only mode: `disallowedTools: ['Write', 'Edit', 'Delete']`
- No shell access: `disallowedTools: ['Bash']`
- Safe git: `allowedTools: ['Bash(git log:*)', 'Bash(git diff:*)']`
- No MCP: `disallowedTools: ['mcp__*']`

**Permission Behavior**:
| Configuration | CLI Flag Behavior | Result |
|--------------|-------------------|---------|
| No config | No `--allowedTools` or `--disallowedTools` | Falls back to settings.json and interactive prompts |
| `allowedTools: []` | `--allowedTools` (empty) | Explicit empty allowlist - blocks all tools |
| `allowedTools: ['Read']` | `--allowedTools Read` | Only allows Read tool |
| `disallowedTools: []` | `--disallowedTools` (empty) | No effect - normal permissions apply |
| `disallowedTools: ['Write']` | `--disallowedTools Write` | Blocks Write tool, others follow normal permissions |

## Advanced Configuration

### MCP Server Support

The provider supports Model Context Protocol (MCP) servers for extended functionality:

```typescript
const claude = createClaudeCode({
  mcpServers: {
    filesystem: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
    },
    github: {
      type: 'sse',
      url: 'https://mcp.github.com/api',
      headers: { Authorization: 'Bearer YOUR_TOKEN' },
    },
  },
});
```

### Permission Modes

Control how Claude Code handles tool permissions:

```typescript
const claude = createClaudeCode({
  permissionMode: 'bypassPermissions', // Skip all permission prompts
  // Other options: 'default', 'acceptEdits', 'plan'
});
```

### Custom System Prompts

```typescript
const claude = createClaudeCode({
  customSystemPrompt: 'You are an expert Python developer.',
  // Or append to existing prompt:
  appendSystemPrompt: 'Always use type hints in Python code.',
});
```

## Request Cancellation

The provider supports request cancellation through the standard AbortController API:

```typescript
import { generateText } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';

// Create abort controller
const controller = new AbortController();

// Start request
const promise = generateText({
  model: claudeCode('opus'),
  prompt: 'Write a long story...',
  abortSignal: controller.signal,
});

// Cancel the request
controller.abort();

// The promise rejects with AbortError
try {
  await promise;
} catch (error) {
  if (error.name === 'AbortError') {
    console.log('Request was cancelled');
  }
}
```

This is especially useful in UI scenarios where users might cancel requests or navigate away.

## Implementation Details

### SDK Message Types

The SDK provides structured message types for different events:

#### Assistant Message

```typescript
{
  type: 'assistant',
  message: {
    content: [{ type: 'text', text: 'Hello!' }],
    // ... other fields
  },
  session_id: 'abc-123-def'
}
```

#### Result Message

```typescript
{
  type: 'result',
  subtype: 'success' | 'error_max_turns' | 'error_during_execution',
  session_id: 'abc-123-def',
  usage: { /* token counts */ },
  total_cost_usd: 0.001,
  duration_ms: 1500
}
```

#### System Message

```typescript
{
  type: 'system',
  subtype: 'init',
  session_id: 'abc-123-def',
  tools: ['Read', 'Write', 'Bash'],
  model: 'opus'
}
```

### SDK Implementation

The provider uses the official `@anthropic-ai/claude-code` SDK which provides:

- **AsyncGenerator pattern**: Native streaming support with `query()` function
- **Structured messages**: Rich message types (assistant, result, system, error)
- **Built-in features**: AbortController, session management, MCP servers
- **Automatic handling**: Process management, error handling, and output parsing

### Provider Metadata

The provider returns rich metadata including token usage, timing, and cost information:

```typescript
const { text, usage, providerMetadata } = await generateText({
  model: claudeCode('sonnet'),
  prompt: 'Hello!',
});

console.log(providerMetadata);
// {
//   "claude-code": {
//     "sessionId": "abc-123-def",
//     "costUsd": 0.0285561,      // Note: Always non-zero for tracking
//     "durationMs": 3056,
//     "rawUsage": {
//       "inputTokens": 4,
//       "outputTokens": 7,
//       "cacheCreationInputTokens": 5924,
//       "cacheReadInputTokens": 10075
//     }
//   }
// }
```

**Important Note about Costs**: The `costUsd` field shows the cost of the API usage:

- **For Pro/Max subscribers**: This is informational only - usage is covered by your monthly subscription
- **For API key users**: This represents actual charges that will be billed to your account

## Object Generation

The provider supports object generation through prompt engineering, allowing you to generate structured data with JSON schema validation:

```typescript
import { generateObject, streamObject } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';
import { z } from 'zod';

// Generate a complete object
const { object } = await generateObject({
  model: claudeCode('sonnet'),
  schema: z.object({
    recipe: z.object({
      name: z.string(),
      ingredients: z.array(z.string()),
      instructions: z.array(z.string()),
      prepTime: z.number(),
      servings: z.number(),
    }),
  }),
  prompt: 'Generate a recipe for chocolate chip cookies',
});

// Note: streamObject waits for complete response before parsing
// Use generateObject for clarity since streaming doesn't provide benefits
const { object: analysis } = await generateObject({
  model: claudeCode('sonnet'),
  schema: z.object({
    analysis: z.string(),
    sentiment: z.enum(['positive', 'negative', 'neutral']),
    score: z.number(),
  }),
  prompt: 'Analyze this review: "Great product!"',
});

console.log(analysis);
```

**How it works**: The provider appends JSON generation instructions to your prompt and uses a tolerant JSON parser to extract valid output from Claude's response. Minor issues like trailing commas or comments are automatically handled, though this is still not as strict as native JSON mode.

**Important notes**:

- **Object mode support**: Only `object-json` mode is supported (via `generateObject`/`streamObject`). The provider uses prompt engineering and JSON extraction to ensure reliable object generation.
- **Streaming behavior**: While `streamObject` is supported, it accumulates the full response before extracting JSON to ensure validity. Regular text streaming works in real-time.

## Object Generation Cookbook

### Quick Start Examples

#### Basic Objects

Start with simple schemas and clear prompts:

```typescript
const { object } = await generateObject({
  model: claudeCode('sonnet'),
  schema: z.object({
    name: z.string(),
    age: z.number(),
    email: z.string().email(),
  }),
  prompt: 'Generate a developer profile',
});
```

[Full example](../examples/generate-object-basic.ts)

#### Nested Structures

Build complex hierarchical data:

```typescript
const { object } = await generateObject({
  model: claudeCode('sonnet'),
  schema: z.object({
    company: z.object({
      departments: z.array(
        z.object({
          name: z.string(),
          teams: z.array(
            z.object({
              name: z.string(),
              members: z.number(),
            })
          ),
        })
      ),
    }),
  }),
  prompt: 'Generate a company org structure',
});
```

[Full example](../examples/generate-object-nested.ts)

#### Constrained Generation

Use Zod's validation features:

```typescript
const { object } = await generateObject({
  model: claudeCode('sonnet'),
  schema: z.object({
    status: z.enum(['pending', 'active', 'completed']),
    priority: z.number().min(1).max(5),
    tags: z.array(z.string()).min(1).max(3),
  }),
  prompt: 'Generate a task with medium priority',
});
```

[Full example](../examples/generate-object-constraints.ts)

### Best Practices

1. **Start Simple**: Begin with basic schemas and add complexity gradually
2. **Clear Prompts**: Be specific about what you want generated
3. **Use Descriptions**: Add `.describe()` to schema fields for better results
4. **Handle Errors**: Implement retry logic for production use
5. **Test Schemas**: Validate your schemas work before deployment

### Common Patterns

- **Data Models**: [User profiles, products, orders](../examples/generate-object-nested.ts)
- **Validation**: [Enums, constraints, regex patterns](../examples/generate-object-constraints.ts)
- **Basic Objects**: [Simple schemas and arrays](../examples/generate-object-basic.ts)
- **Note**: For object generation, use `generateObject` instead of `streamObject` as streaming provides no benefits

## Object Generation Troubleshooting

### Common Issues and Solutions

#### 1. Invalid JSON Response

**Problem**: Claude returns text instead of valid JSON

**Solutions**:

- Simplify your schema - start with fewer fields
- Make your prompt more explicit: "Generate only valid JSON"
- Check the schema for overly complex constraints
- Use the retry pattern:

```typescript
async function generateWithRetry(schema, prompt, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await generateObject({ model, schema, prompt });
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i)));
    }
  }
}
```

#### 2. Missing Required Fields

**Problem**: Generated objects missing required properties

**Solutions**:

- Emphasize requirements in your prompt
- Use descriptive field names
- Add field descriptions with `.describe()`
- Example:

```typescript
z.object({
  // Bad: vague field name
  val: z.number(),

  // Good: clear field name with description
  totalPrice: z.number().describe('Total price in USD'),
});
```

#### 3. Type Mismatches

**Problem**: String when expecting number, wrong date format, etc.

**Solutions**:

- Be explicit in descriptions: "age as a number" not just "age"
- For dates, specify format: `.describe('Date in YYYY-MM-DD format')`
- Use regex patterns for strings: `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)`

#### 4. Schema Too Complex

**Problem**: Very complex schemas fail or timeout

**Solutions**:

- Break into smaller parts and combine:

```typescript
// Instead of one huge schema, compose smaller ones
const userSchema = z.object({
  /* user fields */
});
const settingsSchema = z.object({
  /* settings */
});
const profileSchema = z.object({
  user: userSchema,
  settings: settingsSchema,
});
```

- Generate in steps and merge results
- Increase timeout for complex generations

#### 5. Inconsistent Results

**Problem**: Same prompt gives different structure each time

**Solutions**:

- Make schemas more constrained (use enums, min/max)
- Provide example in prompt
- Use consistent field naming conventions
- Consider using `opus` model for complex schemas

### Debugging Tips

1. **Enable Debug Logging**:

```typescript
const { object, usage, warnings } = await generateObject({
  model: claudeCode('sonnet'),
  schema: yourSchema,
  prompt: yourPrompt,
});
console.log('Tokens used:', usage);
console.log('Warnings:', warnings);
```

2. **Test Schema Separately**:

```typescript
// Validate your schema works
const testData = {
  /* your test object */
};
try {
  schema.parse(testData);
  console.log('Schema is valid');
} catch (e) {
  console.log('Schema errors:', e.errors);
}
```

3. **Progressive Enhancement**:
   Start with minimal schema, test, then add fields one by one

4. **Check Examples**:
   Review our examples for implementation patterns

## Limitations

- **No image support**: The Claude Code SDK doesn't support image inputs (provider sets `supportsImageUrls = false`)
- **No embedding support**: Text embeddings are not available through this provider
- **Object-tool mode not supported**: Only `object-json` mode works via `generateObject`/`streamObject`. The AI SDK's tool calling interface is not implemented
- **Text-only responses**: No support for file generation or other modalities
- **Session management**: While sessions are supported, message history is the recommended approach
- **Unsupported generation settings**: The following AI SDK settings are ignored and will generate warnings:
  - `temperature` - Claude Code SDK doesn't expose temperature control
  - `maxTokens` - Token limits aren't configurable via CLI
  - `topP`, `topK` - Sampling parameters aren't available
  - `presencePenalty`, `frequencyPenalty` - Penalty parameters aren't supported
  - `stopSequences` - Custom stop sequences aren't available
  - `seed` - Deterministic generation isn't supported

## Error Handling

The provider uses standard AI SDK error classes for better ecosystem compatibility:

```typescript
import { generateText } from 'ai';
import { APICallError, LoadAPIKeyError } from '@ai-sdk/provider';
import {
  claudeCode,
  isAuthenticationError,
  isTimeoutError,
  getErrorMetadata,
} from 'ai-sdk-provider-claude-code';

try {
  const { text } = await generateText({
    model: claudeCode('opus'),
    prompt: 'Hello!',
  });
} catch (error) {
  if (isAuthenticationError(error)) {
    console.error('Please run "claude login" to authenticate');
  } else if (isTimeoutError(error)) {
    console.error('Request timed out. Consider using AbortController with a custom timeout.');
  } else if (error instanceof APICallError) {
    // Get CLI-specific metadata
    const metadata = getErrorMetadata(error);
    console.error('CLI error:', {
      message: error.message,
      isRetryable: error.isRetryable,
      exitCode: metadata?.exitCode,
      stderr: metadata?.stderr,
    });
  } else {
    console.error('Error:', error);
  }
}
```

### Error Types

- **`LoadAPIKeyError`**: Authentication failures (exit code 401)
- **`APICallError`**: All other CLI failures
  - `isRetryable: true` for timeouts
  - `isRetryable: false` for SDK errors, authentication failures, etc.
  - Contains metadata with `exitCode`, `stderr`, `promptExcerpt`

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for solutions to common issues including:

- Authentication problems
- SDK installation issues
- Session management
- Platform-specific issues
- Timeout handling with AbortSignal

## Project Structure

```
ai-sdk-provider-claude-code/
├── src/                               # Source code
│   ├── index.ts                       # Main exports
│   ├── claude-code-provider.ts        # Provider factory
│   ├── claude-code-language-model.ts  # AI SDK implementation using SDK
│   ├── convert-to-claude-code-messages.ts # Message format converter
│   ├── extract-json.ts                # JSON extraction for object generation
│   ├── errors.ts                      # Error handling utilities
│   ├── logger.ts                      # Configurable logger support
│   ├── map-claude-code-finish-reason.ts # Finish reason mapping utilities
│   ├── types.ts                       # TypeScript types and interfaces
│   ├── validation.ts                  # Input validation utilities
│   ├── *.test.ts                      # Test files for each module
│   └── logger.integration.test.ts     # Logger integration tests
├── examples/                          # Example usage scripts
│   ├── README.md                      # Examples documentation
│   ├── abort-signal.ts                # Request cancellation examples
│   ├── basic-usage.ts                 # Simple text generation with metadata
│   ├── check-cli.ts                   # CLI installation verification
│   ├── conversation-history.ts        # Multi-turn conversation with message history
│   ├── custom-config.ts               # Provider configuration options
│   ├── generate-object.ts             # Original object generation example
│   ├── generate-object-basic.ts       # Basic object generation patterns
│   ├── generate-object-constraints.ts # Validation and constraints
│   ├── generate-object-nested.ts      # Complex nested structures
│   ├── integration-test.ts            # Comprehensive integration tests
│   ├── limitations.ts                 # Provider limitations demo
│   ├── long-running-tasks.ts          # Timeout handling with AbortSignal
│   ├── streaming.ts                   # Streaming response demo
│   ├── test-session.ts                # Session management testing
│   └── tool-management.ts             # Tool access control (allow/disallow)
├── docs/                              # Documentation
│   ├── GUIDE.md                       # Comprehensive guide (this file)
│   ├── DEVELOPMENT-STATUS.md          # Development status and roadmap
│   └── TROUBLESHOOTING.md             # Common issues and solutions
├── CHANGELOG.md                       # Version history
├── CODE_REVIEW_PLAN.md                # Development planning documentation
├── LICENSE                            # MIT License
├── README.md                          # Main project documentation
├── eslint.config.js                   # ESLint configuration
├── package.json                       # Project metadata and dependencies
├── package-lock.json                  # Dependency lock file
├── run-all-examples.sh                # Script to run all examples
├── tsconfig.json                      # TypeScript configuration
├── tsup.config.ts                     # Build configuration
└── vitest.config.ts                   # Test runner configuration
```

## Known Limitations

1. **No image support**: The CLI doesn't accept image inputs
2. **Authentication required**: Requires separate Claude Code SDK authentication (`claude login`)
3. **Session IDs change**: Each request gets a new session ID, even when using `--resume`
4. **No AI SDK tool calling interface**: The AI SDK's function/tool calling interface is not implemented, but Claude can use tools via MCP servers and built-in CLI tools

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting a PR.

**Alpha Focus Areas:**

- Code structure improvements (AI-generated code cleanup)
- Performance optimizations
- Better error handling patterns
- TypeScript type improvements
- Additional example use cases

### Dependency Management

This project uses exact dependency versions to ensure consistent behavior across all installations. When updating dependencies:

1. Update the exact version in `package.json`
2. Run `npm install` to update the lock file
3. Test thoroughly before committing

Note: Peer dependencies (like `zod`) use version ranges as per npm best practices.

## License

MIT - see [LICENSE](../LICENSE) for details.

## Acknowledgments

This provider is built for the [Vercel AI SDK](https://sdk.vercel.ai/) and uses the [Claude Code SDK](https://docs.anthropic.com/claude-code/cli) by Anthropic.
