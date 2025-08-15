<p align="center">
  <img src="https://img.shields.io/badge/status-stable-00A79E" alt="stable status">
  <a href="https://www.npmjs.com/package/ai-sdk-provider-claude-code"><img src="https://img.shields.io/npm/v/ai-sdk-provider-claude-code?color=00A79E" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/ai-sdk-provider-claude-code"><img src="https://img.shields.io/npm/unpacked-size/ai-sdk-provider-claude-code?color=00A79E" alt="install size" /></a>
  <a href="https://www.npmjs.com/package/ai-sdk-provider-claude-code"><img src="https://img.shields.io/npm/dy/ai-sdk-provider-claude-code.svg?color=00A79E" alt="npm downloads" /></a>
  <a href="https://nodejs.org/en/about/releases/"><img src="https://img.shields.io/badge/node-%3E%3D18-00A79E" alt="Node.js ≥ 18" /></a>
  <a href="https://www.npmjs.com/package/ai-sdk-provider-claude-code"><img src="https://img.shields.io/npm/l/ai-sdk-provider-claude-code?color=00A79E" alt="License: MIT" /></a>
</p>

# AI SDK Provider for Claude Code SDK

> **Stable Release**: Version 1.x is now stable and compatible with AI SDK v5. For AI SDK v4 support, use the `ai-sdk-v4` tag or version 0.2.x.

**ai-sdk-provider-claude-code** lets you use Claude via the [Vercel AI SDK](https://sdk.vercel.ai/docs) through the official `@anthropic-ai/claude-code` SDK/CLI.

## Version Compatibility

| Provider Version | AI SDK Version | NPM Tag | Status | Branch |
|-----------------|----------------|---------|---------|--------|
| 1.x | v5 | `latest` | Stable | `main` |
| 0.x | v4 | `ai-sdk-v4` | Maintenance | [`ai-sdk-v4`](https://github.com/ben-vargas/ai-sdk-provider-claude-code/tree/ai-sdk-v4) |

### Installing the Right Version

**For AI SDK v5 (recommended):**
```bash
npm install ai-sdk-provider-claude-code ai
# or explicitly: npm install ai-sdk-provider-claude-code@latest
```

**For AI SDK v4 (legacy):**
```bash
npm install ai-sdk-provider-claude-code@ai-sdk-v4 ai@^4.3.16
# or use specific version: npm install ai-sdk-provider-claude-code@^0.2.2

## Installation

### 1. Install and authenticate the CLI
```bash
npm install -g @anthropic-ai/claude-code
claude login
```

### 2. Add the provider
```bash
# For v5 (recommended)
npm install ai-sdk-provider-claude-code ai

# For v4 (legacy)
npm install ai-sdk-provider-claude-code@ai-sdk-v4 ai@^4.3.16
```

## Disclaimer

**This is an unofficial community provider** and is not affiliated with or endorsed by Anthropic or Vercel. By using this provider:

- You understand that your data will be sent to Anthropic's servers through the Claude Code SDK
- You agree to comply with [Anthropic's Terms of Service](https://www.anthropic.com/legal/consumer-terms)
- You acknowledge this software is provided "as is" without warranties of any kind

Please ensure you have appropriate permissions and comply with all applicable terms when using this provider.

## Quick Start

### AI SDK v5
```typescript
import { streamText } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';

const result = streamText({
  model: claudeCode('sonnet'),
  prompt: 'Hello, Claude!'
});

const text = await result.text;
console.log(text);
```

### AI SDK v4
```typescript
import { generateText } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';

const { text } = await generateText({
  model: claudeCode('sonnet'),
  prompt: 'Hello, Claude!'
});

console.log(text);
```

## Breaking Changes in v1.x

See [Breaking Changes Guide](docs/ai-sdk-v5/V5_BREAKING_CHANGES.md) for details on migrating from v0.x to v1.x.

Key changes:
- Requires AI SDK v5
- New streaming API pattern
- Updated token usage properties
- Changed message types

## Models

- **`opus`** - Claude 4 Opus (most capable)
- **`sonnet`** - Claude 4 Sonnet (balanced performance)

## Documentation

- **[Usage Guide](docs/ai-sdk-v5/GUIDE.md)** - Comprehensive examples and configuration
- **[Breaking Changes](docs/ai-sdk-v5/V5_BREAKING_CHANGES.md)** - v0.x to v1.x migration guide
- **[Troubleshooting](docs/ai-sdk-v5/TROUBLESHOOTING.md)** - Common issues and solutions
- **[Examples](examples/)** - Sample scripts and patterns

## Core Features

- 🚀 Vercel AI SDK compatibility
- 🔄 Streaming support
- 💬 Multi-turn conversations
- 🎯 Object generation with JSON schemas
- 🛑 AbortSignal support
- 🔧 Tool management (MCP servers, permissions)

## Limitations

- Requires Node.js ≥ 18
- No image support
- Some AI SDK parameters unsupported (temperature, maxTokens, etc.)

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