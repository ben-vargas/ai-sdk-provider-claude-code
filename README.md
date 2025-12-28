<p align="center">
  <img src="https://img.shields.io/badge/status-stable-00A79E" alt="stable status">
  <a href="https://www.npmjs.com/package/ai-sdk-provider-claude-code"><img src="https://img.shields.io/npm/v/ai-sdk-provider-claude-code?color=00A79E" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/ai-sdk-provider-claude-code"><img src="https://img.shields.io/npm/unpacked-size/ai-sdk-provider-claude-code?color=00A79E" alt="install size" /></a>
  <a href="https://www.npmjs.com/package/ai-sdk-provider-claude-code"><img src="https://img.shields.io/npm/dy/ai-sdk-provider-claude-code.svg?color=00A79E" alt="npm downloads" /></a>
  <a href="https://nodejs.org/en/about/releases/"><img src="https://img.shields.io/badge/node-%3E%3D18-00A79E" alt="Node.js ≥ 18" /></a>
  <a href="https://www.npmjs.com/package/ai-sdk-provider-claude-code"><img src="https://img.shields.io/npm/l/ai-sdk-provider-claude-code?color=00A79E" alt="License: MIT" /></a>
</p>

# AI SDK Provider for Claude Code SDK

> **Latest Release**: Version 3.x supports AI SDK v6 stable with the Claude Agent SDK. For AI SDK v5 support, use the `ai-sdk-v5` tag.

**ai-sdk-provider-claude-code** lets you use Claude via the [Vercel AI SDK](https://sdk.vercel.ai/docs) through the official `@anthropic-ai/claude-agent-sdk` and the Claude Code CLI.

## Version Compatibility

| Provider Version | AI SDK Version | Underlying SDK                       | NPM Tag              | Status | Branch                                                                                  |
| ---------------- | -------------- | ------------------------------------ | -------------------- | ------ | --------------------------------------------------------------------------------------- |
| 3.x.x            | v6             | `@anthropic-ai/claude-agent-sdk`     | `latest`             | Stable | `main`                                                                                  |
| 2.x.x            | v5             | `@anthropic-ai/claude-agent-sdk`     | `ai-sdk-v5`          | Stable | [`ai-sdk-v5`](https://github.com/ben-vargas/ai-sdk-provider-claude-code/tree/ai-sdk-v5) |
| 1.x.x            | v5             | `@anthropic-ai/claude-code` (legacy) | `v1-claude-code-sdk` | Legacy | [`v1`](https://github.com/ben-vargas/ai-sdk-provider-claude-code/tree/v1)               |
| 0.x.x            | v4             | `@anthropic-ai/claude-code` (legacy) | `ai-sdk-v4`          | Legacy | [`ai-sdk-v4`](https://github.com/ben-vargas/ai-sdk-provider-claude-code/tree/ai-sdk-v4) |

### Installing the Right Version

**For AI SDK v6 (recommended):**

```bash
npm install ai-sdk-provider-claude-code ai@^6.0.0
# or explicitly: npm install ai-sdk-provider-claude-code@latest
```

**For AI SDK v5:**

```bash
npm install ai-sdk-provider-claude-code@ai-sdk-v5 ai@^5.0.0
```

**For AI SDK v4 (legacy):**

```bash
npm install ai-sdk-provider-claude-code@ai-sdk-v4 ai@^4.3.16
# or use specific version: npm install ai-sdk-provider-claude-code@^0.2.2
```

## Zod Compatibility

This package is **fully compatible with both Zod 3 and Zod 4**.

```bash
# With Zod 3
npm install ai-sdk-provider-claude-code ai zod@^3.0.0

# With Zod 4
npm install ai-sdk-provider-claude-code ai zod@^4.0.0
```

Both this package and the underlying `@anthropic-ai/claude-agent-sdk` declare support for both versions (`peerDependencies: "zod": "^3.24.1 || ^4.0.0"`).

## Installation

### 1. Install and authenticate the CLI

```bash
npm install -g @anthropic-ai/claude-code
claude login
```

### 2. Add the provider

```bash
# For AI SDK v6 (recommended)
npm install ai-sdk-provider-claude-code ai@^6.0.0

# For AI SDK v5
npm install ai-sdk-provider-claude-code@ai-sdk-v5 ai@^5.0.0

# For AI SDK v4 (legacy)
npm install ai-sdk-provider-claude-code@ai-sdk-v4 ai@^4.3.16
```

## Disclaimer

**This is an unofficial community provider** and is not affiliated with or endorsed by Anthropic or Vercel. By using this provider:

- You understand that your data will be sent to Anthropic's servers through the Claude Code SDK
- You agree to comply with [Anthropic's Terms of Service](https://www.anthropic.com/legal/consumer-terms)
- You acknowledge this software is provided "as is" without warranties of any kind

Please ensure you have appropriate permissions and comply with all applicable terms when using this provider.

## Quick Start

### AI SDK v6

```typescript
import { streamText } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';

const result = streamText({
  model: claudeCode('haiku'),
  prompt: 'Hello, Claude!',
});

const text = await result.text;
console.log(text);
```

### AI SDK v5

```typescript
// npm install ai-sdk-provider-claude-code@ai-sdk-v5 ai@^5.0.0
import { streamText } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';

const result = streamText({
  model: claudeCode('haiku'),
  prompt: 'Hello, Claude!',
});

const text = await result.text;
console.log(text);
```

## Breaking Changes

### Version 3.0.0 (AI SDK v6 Stable)

This version upgrades to AI SDK v6 stable with updated provider types:

- **`usage.raw`** now contains raw provider usage (previously in `providerMetadata['claude-code'].rawUsage`)
- Internal type changes for `LanguageModelV3Usage` and `LanguageModelV3FinishReason` (transparent to most users)

### Version 2.0.0 (Claude Agent SDK Migration)

This version migrates to `@anthropic-ai/claude-agent-sdk` with **new defaults for better control**:

- **System prompt** is no longer applied by default
- **Filesystem settings** (CLAUDE.md, settings.json) are no longer loaded by default
- See [Migrating to Claude Agent SDK](#migrating-to-claude-agent-sdk) section below for migration details

### Version 1.x (AI SDK v5)

See [Breaking Changes Guide](docs/ai-sdk-v5/V5_BREAKING_CHANGES.md) for details on migrating from v0.x to v1.x.

Key changes:

- Requires AI SDK v5
- New streaming API pattern
- Updated token usage properties
- Changed message types

## Models

- **`opus`** - Claude Opus (most capable)
- **`sonnet`** - Claude Sonnet (balanced performance)
- **`haiku`** - Claude Haiku (fastest, most cost-effective)

You can also use full model identifiers directly (e.g., `claude-opus-4-5`, `claude-sonnet-4-5-20250514`).

## Documentation

- **[Usage Guide](docs/ai-sdk-v5/GUIDE.md)** - Comprehensive examples and configuration
- **[Breaking Changes](docs/ai-sdk-v5/V5_BREAKING_CHANGES.md)** - v0.x to v1.x migration guide
- **[Troubleshooting](docs/ai-sdk-v5/TROUBLESHOOTING.md)** - Common issues and solutions
- **[Examples](examples/)** - Sample scripts and patterns
- **[Tool Streaming Support](docs/ai-sdk-v5/TOOL_STREAMING_SUPPORT.md)** - Event semantics and performance notes

## Migrating to Claude Agent SDK (v2.0.0)

**Version 2.0.0** migrates from `@anthropic-ai/claude-code` to `@anthropic-ai/claude-agent-sdk`. Two defaults changed:

- System prompt is no longer applied by default.
- Filesystem settings (CLAUDE.md, settings.json) are not loaded by default.

Restore old behavior explicitly:

```ts
import { claudeCode } from 'ai-sdk-provider-claude-code';

const model = claudeCode('sonnet', {
  systemPrompt: { type: 'preset', preset: 'claude_code' },
  settingSources: ['user', 'project', 'local'],
});
```

CLAUDE.md requires:

- `systemPrompt: { type: 'preset', preset: 'claude_code' }`
- `settingSources` includes `'project'`

New recommended behavior (explicit config):

```ts
const model = claudeCode('sonnet', {
  systemPrompt: 'You are a helpful assistant specialized in ...',
  settingSources: ['project'], // or omit for no filesystem settings
});
```

CLI install and auth are unchanged:

```bash
npm install -g @anthropic-ai/claude-code
claude login
```

### Migrating from v1.x to v2.0.0

If you're upgrading from version 1.x:

1. **Update the package**: `npm install ai-sdk-provider-claude-code@latest`
2. **If you relied on default system prompt or CLAUDE.md**, add explicit configuration:
   ```ts
   const model = claudeCode('sonnet', {
     systemPrompt: { type: 'preset', preset: 'claude_code' },
     settingSources: ['user', 'project', 'local'],
   });
   ```
3. **If you never used CLAUDE.md or custom system prompts**, no changes needed - v2.0.0 works the same for you.

**Benefits of v2.0.0**:

- Predictable behavior across environments (no hidden filesystem settings)
- Better suited for CI/CD and multi-tenant applications
- Explicit configuration over implicit defaults
- Future-proof alignment with Claude Agent SDK design

## Structured Outputs

This provider supports **native structured outputs** via the Claude Agent SDK (v0.1.45+). When using `generateObject()` or `streamObject()`, the SDK guarantees schema-compliant JSON responses through constrained decoding.

```typescript
import { generateObject } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';
import { z } from 'zod';

const result = await generateObject({
  model: claudeCode('sonnet'),
  schema: z.object({
    name: z.string(),
    age: z.number(),
    email: z.string().email(),
  }),
  prompt: 'Generate a user profile for a software developer',
});

console.log(result.object); // Guaranteed to match schema
// { name: "Alex Chen", age: 28, email: "alex@example.com" }
```

**Benefits:**

- ✅ **Guaranteed schema compliance** - Constrained decoding ensures valid output
- ✅ **No JSON parsing errors** - SDK handles all validation
- ✅ **No prompt engineering** - Schema enforcement is native to the SDK
- ✅ **Better performance** - No retry/extraction logic needed

> **Note:** A schema is required for JSON output. Using `responseFormat: { type: 'json' }` without a schema is not supported by Claude Code (matching Anthropic's official provider behavior). An `unsupported-setting` warning will be emitted and the call will be treated as plain text. Always use `generateObject()` or `streamObject()` with a Zod schema for guaranteed JSON output.

## Core Features

- 🚀 Vercel AI SDK compatibility
- 🔄 Streaming support
- 💬 Multi-turn conversations
- 🎯 Native structured outputs with guaranteed schema compliance
- 🛑 AbortSignal support
- 🔧 Tool management (MCP servers, permissions)
- 🧩 Callbacks (hooks, canUseTool)

## Image Inputs (Streaming Only)

- Enable streaming input (`streamingInput: 'always'` or provide `canUseTool`) before sending images.
- Supported payloads: data URLs (`data:image/png;base64,...`), strings prefixed with `base64:<mediaType>,<data>`, or objects `{ data: '<base64>', mimeType: 'image/png' }`.
- Remote HTTP(S) image URLs are ignored with the warning "Image URLs are not supported by this provider; supply base64/data URLs." (`supportsImageUrls` remains `false`).
- When streaming input is disabled, image parts trigger the streaming prerequisite warning and are omitted from the request.
- Use realistic image payloads—very small placeholders may result in the model asking for a different image.
- `examples/images.ts` accepts a local image path and converts it to a data URL on the fly: `npx tsx examples/images.ts /absolute/path/to/image.png`.

## Skills Support

Claude Code supports **Skills** - custom tools and capabilities defined in your user or project settings. To enable skills, configure both `settingSources` and `allowedTools`:

```typescript
import { claudeCode } from 'ai-sdk-provider-claude-code';
import { streamText } from 'ai';

const result = await streamText({
  model: claudeCode('sonnet', {
    settingSources: ['user', 'project'],
    allowedTools: ['Skill', 'Read', 'Write', 'Bash'],
  }),
  prompt: 'Use my /custom-skill to help with this task',
});
```

**Requirements:**

- `settingSources` - Where to load skills from (`'user'`, `'project'`, `'local'`)
- `allowedTools` must include `'Skill'` to invoke skills

**Where to define Skills:**

- User: `~/.claude/skills/your-skill/SKILL.md`
- Project: `.claude/skills/your-skill/SKILL.md`

**Validation:** If you add `'Skill'` to `allowedTools` but forget to set `settingSources`, a validation warning will alert you that skills won't load.

See [examples/skills-management.ts](examples/skills-management.ts) for more examples.

## Limitations

- Requires Node.js ≥ 18
- Image inputs require streaming mode with base64/data URLs (remote fetch is not supported)
- Some AI SDK parameters unsupported (temperature, maxTokens, etc.)
- `canUseTool` requires streaming input at the SDK level (AsyncIterable prompt). This provider supports it via `streamingInput`: use `'auto'` (default when `canUseTool` is set) or `'always'`. See GUIDE for details.

## Tool Error Parity (Streaming)

- In addition to `tool-call` and `tool-result`, this provider emits a distinct `tool-error` stream event when a tool execution fails.
- For parity with other tool events, `tool-error` includes `providerExecuted: true` and `providerMetadata['claude-code']` (e.g., `rawError`). These fields are documented extensions; downstream consumers may safely ignore them if unused.
- See Tool Streaming Support for full event list, ordering guarantees, and performance considerations.

## Contributing

We welcome contributions, especially:

- Code structure improvements
- Performance optimizations
- Better error handling
- Additional examples

See [Contributing Guidelines](docs/ai-sdk-v5/GUIDE.md#contributing) for details.

For development status and technical details, see [Development Status](docs/ai-sdk-v5/DEVELOPMENT-STATUS.md).

## License

MIT
