# Troubleshooting Guide (AI SDK v5)

This guide documents common issues and solutions for the Claude Code AI SDK Provider with v5.

## Common Issues

### 1. Authentication Errors

**Problem**: Getting authentication errors when trying to use the provider.

**Solution**:

```bash
# Install Claude Code SDK globally
npm install -g @anthropic-ai/claude-code

# Authenticate with your Claude account
claude login
```

**Verification**:

```bash
# Check if authenticated
npx tsx ../examples/check-cli.ts
```

### 2. SDK Not Found

**Problem**: Error about `@anthropic-ai/claude-agent-sdk` module not found.

**Solution**: The SDK is a dependency of this provider and should be installed automatically. If not:

```bash
npm install @anthropic-ai/claude-agent-sdk
```

### 3. v5 Message Format Errors

**Problem**: Error about invalid message content format.

**Solution**: In v5, user messages must have content as an array of parts:

```typescript
// ❌ Wrong (v4 format)
{ role: 'user', content: 'Hello' }

// ✅ Correct (v5 format)
{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }
```

### 4. Streaming API Changes

**Problem**: Streaming code from v4 doesn't work.

**Solution**: v5 uses a new streaming pattern with promises:

```typescript
// ❌ Old v4 pattern
const { textStream } = await streamText({
  model: claudeCode('sonnet'),
  prompt: 'Hello',
});

// ✅ New v5 pattern
const result = streamText({
  model: claudeCode('sonnet'),
  prompt: 'Hello',
});

// Access parts as promises
const text = await result.text;
const usage = await result.usage;

// Or stream chunks
for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

### 5. Token Usage Property Names

**Problem**: Getting undefined for `promptTokens` or `completionTokens`.

**Solution**: Token properties have been renamed in v5:

```typescript
// ❌ Old v4 names
console.log(usage.promptTokens);
console.log(usage.completionTokens);

// ✅ New v5 names
console.log(usage.inputTokens);
console.log(usage.outputTokens);
console.log(usage.totalTokens); // New in v5
```

### 6. Handling Long-Running Tasks

**Problem**: Complex queries with Claude Opus 4 may take longer due to extended thinking mode.

**Solution**: Use AbortSignal with custom timeouts:

```typescript
import { generateText } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';

// Create a custom timeout (5 minutes for complex tasks)
const controller = new AbortController();
const timeoutId = setTimeout(() => {
  controller.abort(new Error('Request timeout'));
}, 300000);

try {
  const result = await generateText({
    model: claudeCode('opus'),
    prompt: 'Complex reasoning task...',
    abortSignal: controller.signal,
  });
  clearTimeout(timeoutId);
  console.log(result.text);
} catch (error) {
  if (error.name === 'AbortError') {
    console.log('Request timed out');
  }
}
```

**Guidelines**:

- Simple queries: Default timeout is sufficient
- Complex reasoning: 5-10 minutes may be needed
- Very long tasks: Consider breaking into smaller chunks

### 7. Object Generation Issues

**Problem**: Claude returns text instead of valid JSON when using `generateObject`.

**Solutions**:

1. **Simplify your schema** - Start with fewer fields
2. **Clear prompts** - Be explicit: "Generate a user profile with name and age"
3. **Use descriptions** - Add `.describe()` to schema fields
4. **Retry logic** - Implement retries for production:

```typescript
async function generateWithRetry(schema, prompt, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await generateObject({
        model: claudeCode('sonnet'),
        schema,
        prompt,
      });
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i)));
    }
  }
}
```

### 8. Session Management

**Problem**: Conversations don't maintain context.

**Solution**: Use message history with v5 format:

```typescript
import { ModelMessage } from 'ai';

const messages: ModelMessage[] = [
  { role: 'user', content: [{ type: 'text', text: 'My name is Alice' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'Nice to meet you, Alice!' }] },
  { role: 'user', content: [{ type: 'text', text: 'What is my name?' }] },
];

const result = await generateText({
  model: claudeCode('sonnet'),
  messages, // Pass full conversation history
});
```

**Note**: While the provider returns session IDs in metadata, the recommended approach is to use message history for conversation continuity.

### 9. Error Handling

**Problem**: Need to handle different types of errors appropriately.

**Solution**: Use the provider's error utilities:

```typescript
import { isAuthenticationError, getErrorMetadata } from 'ai-sdk-provider-claude-code';

try {
  const result = await generateText({
    model: claudeCode('sonnet'),
    prompt: 'Hello',
  });
} catch (error) {
  if (isAuthenticationError(error)) {
    console.error('Please run: claude login');
  } else if (error.name === 'AbortError') {
    console.error('Request was cancelled or timed out');
  } else {
    // Get additional error details
    const metadata = getErrorMetadata(error);
    console.error('Error details:', metadata);
  }
}
```

## v5-Specific Migration Issues

### 1. Result Structure Changes

**Problem**: Code expecting v4 result structure fails.

**Solution**: Update to v5 result structure:

```typescript
// ❌ v4 pattern
const { text, usage } = await generateText(...);

// ✅ v5 pattern
const result = await generateText(...);
console.log(result.text);
console.log(result.usage);
```

### 2. Stream Event Changes

**Problem**: Stream events have different names.

**Solution**: v5 includes a `stream-start` event:

```typescript
const result = streamText({
  model: claudeCode('sonnet'),
  prompt: 'Hello',
});

// v5 stream includes: stream-start, text-delta, finish
for await (const chunk of result.fullStream) {
  switch (chunk.type) {
    case 'stream-start':
      console.log('Stream started');
      break;
    case 'text-delta':
      process.stdout.write(chunk.textDelta);
      break;
    case 'finish':
      console.log('Stream finished');
      break;
  }
}
```

### 3. Unsupported Settings

**Problem**: Getting warnings about unsupported settings.

**Solution**: Some v4 settings are renamed or removed in v5:

```typescript
// ❌ v4 setting names
{
  maxTokens: 1000;
}

// ✅ v5 setting names
{
  maxOutputTokens: 1000;
}

// Note: Many settings like temperature, topP, etc. are still not supported by Claude Code SDK
```

## Debugging Tips

### 1. Verify Setup

```bash
# Check Claude CLI version
claude --version

# Test authentication
npx tsx ../examples/check-cli.ts

# Run integration tests
npx tsx ../examples/integration-test.ts
```

### 2. Enable Debug Logging

```typescript
// Log provider metadata to debug issues
const result = await generateText({
  model: claudeCode('sonnet'),
  prompt: 'Test',
});

console.log('Metadata:', result.providerMetadata);
// Shows: sessionId, costUsd, durationMs, rawUsage
```

### 3. Test Specific Features

```bash
# Test streaming
npx tsx ../examples/streaming.ts

# Test object generation
npx tsx ../examples/generate-object-basic.ts

# Test conversations
npx tsx ../examples/conversation-history.ts

# Test long-running tasks
npx tsx ../examples/long-running-tasks.ts
```

## Platform-Specific Issues

### Windows

- Ensure Claude CLI is in your PATH
- Use PowerShell or Command Prompt (not WSL) for installation

### macOS

- May need to allow CLI in Security & Privacy settings
- Use Homebrew or direct npm installation

### Linux

- Ensure Node.js ≥ 18 is installed
- May need to use `sudo` for global npm installs

## Performance Tips

1. **Model Selection**
   - Use `sonnet` for faster responses
   - Use `opus` for complex reasoning tasks

2. **Request Optimization**
   - Keep prompts concise and clear
   - Use streaming for better UX
   - Implement proper error handling

3. **Resource Management**
   - The provider manages concurrent requests automatically
   - Use AbortSignal for cancellable requests
   - Clean up timeouts in finally blocks

## Known Limitations

1. **Image Support Requires Streaming Mode**: Image inputs are supported via streaming mode with base64/data URLs. See `examples/images.ts`. Remote HTTP(S) URLs are not supported.
2. **No AI SDK Tool Calling**: The AI SDK's function calling interface isn't implemented, but Claude can use tools via MCP servers and built-in CLI tools
3. **Object Generation**: Relies on prompt engineering rather than native JSON mode
4. **Model Options**: Limited to 'opus' and 'sonnet' models

## Getting Help

1. **Check Examples**: Review the `../../examples` directory for working code
2. **Integration Test**: Run `npx tsx ../../examples/integration-test.ts` to verify setup
3. **GitHub Issues**: Report bugs at https://github.com/ben-vargas/ai-sdk-provider-claude-code/issues
4. **Documentation**: See the README.md and GUIDE.md for detailed API documentation

## Common Error Messages

| Error                              | Cause                 | Solution                                       |
| ---------------------------------- | --------------------- | ---------------------------------------------- |
| "Claude Code executable not found" | CLI not installed     | Run `npm install -g @anthropic-ai/claude-code` |
| "Authentication required"          | Not logged in         | Run `claude login`                             |
| "No object generated"              | Invalid JSON response | Simplify schema, improve prompt                |
| "Request timeout"                  | Task took too long    | Increase timeout with AbortSignal              |
| "Session not found"                | Invalid session ID    | Use message history instead                    |
| "Invalid message content"          | v4 message format     | Update to v5 array format                      |
| "promptTokens is undefined"        | v4 property names     | Use inputTokens/outputTokens                   |
