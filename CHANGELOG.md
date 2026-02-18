# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Security

### Fixed

## [3.4.2] - 2026-02-17

### Fixed

- **MCP server connection warnings** - When MCP servers report `failed` or `needs-auth` status during session init, a structured warning is now emitted via `logger.warn` (e.g. `[claude-code] MCP servers not connected: filesystem:failed (connection refused), exa:needs-auth`). Applies to both `doGenerate` and `doStream` paths.

## [3.4.1] - 2026-02-18

### Added

- **External MCP examples** - Added `examples/mcp-filesystem.ts` (official `@modelcontextprotocol/server-filesystem` over stdio) and `examples/mcp-exa.ts` (Exa hosted MCP over HTTP with optional API key support).
- **Example run scripts** - Added `example:mcp:filesystem` and `example:mcp:exa` npm scripts for quick validation of external MCP integration.

### Changed

- **Examples documentation** - Expanded `examples/README.md` with both new MCP examples and updated section numbering for consistency.

## [3.4.0] - 2026-02-05

### Added

- **Claude Agent SDK v0.2.33+ compatibility** - Bumped minimum dependency to `@anthropic-ai/claude-agent-sdk@^0.2.33`.
- **`sessionId` setting** - Pass a custom session ID to the SDK for deterministic session tracking.
- **`debug` / `debugFile` settings** - Enable programmatic debug logging and file output from the SDK (v0.2.30+).
- **`stop_reason` finish reason mapping** - When the SDK provides a `stop_reason` field (v0.2.31+), it is used for more precise AI SDK finish reason mapping (`end_turn`, `max_tokens`, `stop_sequence`, `tool_use`).
- **`ToolAnnotations` support** - `createCustomMcpServer` now accepts optional `annotations` per tool for MCP tool hints (`readOnlyHint`, `destructiveHint`, `openWorldHint`, `idempotentHint`).
- **Re-exported types** - `ToolAnnotations`, `MinimalCallToolResult`, `TeammateIdleHookInput`, and `TaskCompletedHookInput` are now exported from the package entry point.

### Fixed

- **`generateObject` examples** - Replaced `.email()`, `.url()`, `.uuid()`, and complex regex with `.describe()` hints to avoid CLI silent fallback to prose. Consolidated 4 example files into 2.

## [3.3.6] - 2026-02-02

### Fixed

- **Tool input race** - Preserve tool input when a content block stop arrives after the assistant tool_use message, ensuring the final tool-call emits the correct payload.

## [3.3.5] - 2026-01-31

### Fixed

- **Stream text lifecycle** - Prevents duplicate text-end events when a user message arrives mid text content block.

## [3.3.4] - 2026-01-28

### Added

- **Mid-session message injection** - Added `onStreamStart` and `MessageInjector` to enable injecting messages during active sessions, plus an example and tests covering delivery tracking and recovery.

### Changed

- **Updated Claude Agent SDK to ^0.2.23** - Bumped `@anthropic-ai/claude-agent-sdk` from `^0.2.9` to `^0.2.23` to pick up the latest bug fixes and improvements

## [3.3.3] - 2026-01-23

### Added

- **Model usage metadata** - Expose Claude Agent SDK per-model usage metrics (including context window and max output tokens) via `providerMetadata['claude-code'].modelUsage`

## [3.3.2] - 2026-01-18

### Added

- **Mid-stream query access** - Added `onQueryCreated` to expose the SDK `Query` for advanced controls like `streamInput()`, plus a new mid-stream injection example
- **Query type re-export** - Re-exported `Query` from the SDK for type-safe usage
- **Test coverage** - Added tests to validate `onQueryCreated` in both generate and stream paths

## [3.3.1] - 2026-01-15

### Added

- **Structured output repro example** - Added `examples/structured-output-repro.ts` to demonstrate CLI fallbacks for certain JSON Schema features (format constraints, complex regex)
- **Documentation updates** - Clarified structured output limitations and recommended client-side validation in README and examples

### Changed

- **Updated Claude Agent SDK to ^0.2.9** - Keeps provider aligned with latest CLI/SDK behavior

## [3.3.0] - 2026-01-15

### Added

- **MCP tool result normalization** - Handles MCP content format (`[{type: 'text', text: '...'}]`) in tool results, automatically extracting and parsing JSON content from text blocks while preserving non-text content blocks (images, resources, audio) unchanged
- **Tool result stream truncation** - Adds `maxToolResultSize` (default 10k) to cap tool results sent to the client stream and truncates oversized `rawResult` metadata to avoid stream bloat
- **Subagent hierarchy tracking** - Tool stream events now include `providerMetadata['claude-code'].parentToolCallId` to expose Task/subagent parent-child relationships; Task tools always emit null, and parallel Task parents remain null when ambiguous
- **Content block streaming** - Supports streaming `content_block_*` events for tool input, text, and reasoning. Tool inputs now stream via `input_json_delta` with tool-call emission at block completion, and extended thinking emits `reasoning-*` stream parts.

### Security

- **Environment variable isolation** - When custom environment variables are provided via `settings.env` or `sdkOptions.env`, only essential system variables are now inherited from the host environment. On POSIX: `PATH`, `HOME`, `SHELL`, `TERM`, `USER`, `LOGNAME`, `LANG`, `LC_ALL`, `TMPDIR`. On Windows: `PATH`, `APPDATA`, `LOCALAPPDATA`, `USERPROFILE`, `TEMP`, `TMP`, `SYSTEMROOT`, `HOMEDRIVE`, `HOMEPATH`, `PATHEXT`, `SYSTEMDRIVE`, `USERNAME`, `WINDIR`. The Claude-specific `CLAUDE_CONFIG_DIR` is also preserved. Previously, all of `process.env` was passed to the subprocess, potentially exposing sensitive credentials. Note: when no custom env is provided, the SDK still inherits the full `process.env` (default behavior). Users who provided custom env and relied on implicit passthrough of other variables will need to explicitly add them to `settings.env`.

### Fixed

- **Streaming finish now closes response** - Closes the stream controller immediately after emitting the `finish` event to prevent streams from hanging when the SDK has already completed the session.

## [3.2.1] - 2026-01-11

### Fixed

- **Streaming text parts now close before tool calls** - Ensures proper text-end events are emitted before tool-input-start, fixing streaming semantics when text and tools are interleaved

## [3.2.0] - 2026-01-07

### Breaking Changes

- **Zod 4 required** - Dropped Zod 3 support due to `@anthropic-ai/claude-agent-sdk@0.2.x` requiring Zod 4. If you need Zod 3 support, use `ai-sdk-provider-claude-code@3.1.x`.

### Added

- **Updated to Claude Agent SDK 0.2.1** - Aligns with Claude Code v2.1.x
- **New `persistSession` option** - When `false`, disables session persistence to disk. Useful for ephemeral or automated workflows where session history is not needed.
- **New `spawnClaudeCodeProcess` option** - Custom function to spawn the Claude Code process, enabling execution in VMs, containers, or remote environments.
- **New permission modes** - Added `'delegate'` and `'dontAsk'` to `permissionMode` validation.
- **Enhanced agent configuration** - Added support for `disallowedTools`, `mcpServers`, and `criticalSystemReminder_EXPERIMENTAL` in agent definitions.
- **Re-exported `SpawnedProcess` and `SpawnOptions` types** - For use with custom `spawnClaudeCodeProcess` implementations.

### Changed

- **Peer dependency updated** - `zod` peer dependency changed from `^3.24.1 || ^4.0.0` to `^4.0.0`.

## [3.1.0] - 2026-01-05

### Added

- **Agent SDK options passthrough (guarded)** - Added `sdkOptions` escape hatch for passing through Agent SDK `Options`, with blocked internal fields (`model`, `abortController`, `prompt`, `outputFormat`)
- **Expanded Agent SDK settings** - Exposed `betas`, `allowDangerouslySkipPermissions`, `enableFileCheckpointing`, `maxBudgetUsd`, `plugins`, `resumeSessionAt`, `sandbox`, and `tools` in `ClaudeCodeSettings`
- **sdkOptions tests** - Added coverage for env/stderr merge preservation and sdkOptions override behavior

### Changed

- **Session resume consistency** - `resume` now stays in sync between query options and streaming prompt session IDs

## [3.0.1] - 2025-12-27

### Added

- **Skills validation warning** - Validation now warns when `'Skill'` is in `allowedTools` but `settingSources` is not set, helping catch misconfiguration where skills would fail to load
- **Skills documentation** - Added Skills Support section to README with configuration examples
- **Skills example** - Added `examples/skills-management.ts` demonstrating correct skills configuration

## [3.0.0] - 2025-12-27

### Breaking Changes

This release upgrades to AI SDK v6 stable, introducing breaking changes to internal types. **User-facing API remains the same.**

#### LanguageModelV3FinishReason format change

The `finishReason` field now returns an object instead of a string:

```ts
// Before (beta)
finishReason: 'stop'

// After (stable)
finishReason: { unified: 'stop', raw: 'success' }
```

- Access the unified reason via `finishReason.unified`
- The original SDK subtype is preserved in `finishReason.raw`

#### LanguageModelV3Usage format change

The `usage` field now uses a nested structure with detailed token breakdown:

```ts
// Before (beta)
usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }

// After (stable)
usage: {
  inputTokens: { total: 10, noCache: 5, cacheRead: 3, cacheWrite: 2 },
  outputTokens: { total: 5, text: undefined, reasoning: undefined },
  raw: { /* original SDK usage object */ }
}
```

- `inputTokens.total` replaces `inputTokens`
- `outputTokens.total` replaces `outputTokens`
- `totalTokens` is removed (calculate as `inputTokens.total + outputTokens.total` if needed)
- Cache token details are now exposed in `inputTokens.cacheRead` and `inputTokens.cacheWrite`
- Original SDK usage is available via `usage.raw` (previously in `providerMetadata.rawUsage`)

### Changed

- **Upgraded to AI SDK v6 stable** (`ai@^6.0.3`, `@ai-sdk/provider@^3.0.0`, `@ai-sdk/provider-utils@^4.0.1`)
- Unknown finish reason subtypes now map to `{ unified: 'other', raw: subtype }` instead of defaulting to `'stop'`
- Truncation finish reason now includes `raw: 'truncation'` for better diagnostics
- Removed `rawUsage` from `providerMetadata` (now available in `usage.raw`)

### Added

- `convertClaudeCodeUsage()` helper function for consistent usage format conversion
- `createEmptyUsage()` helper for zero-initialized usage objects

## [2.2.4] - 2025-12-04

### Changed

- **Updated Claude Agent SDK to ^0.1.59** - Fixes Apple notarization failures for macOS Electron apps
  - The SDK removed the bundled JetBrains plugin which contained unsigned macOS native binaries (`jansi-2.4.1.jar`)
  - This eliminates notarization errors for macOS apps that include the SDK as a dependency
  - See [claude-agent-sdk-typescript#91](https://github.com/anthropics/claude-agent-sdk-typescript/issues/91) for details

## [2.2.3] - 2025-11-26

### Fixed

- **True object streaming** - `streamObject()` now streams partial objects incrementally instead of returning the complete object at the end
  - Added handling for `input_json_delta` events from the SDK's internal `StructuredOutput` tool
  - The AI SDK's `parsePartialJson()` now receives incremental JSON updates to build partial objects
  - **Before**: 1 partial object delivered only at completion
  - **After**: ~100+ partial objects streamed as JSON is generated, enabling real-time UI updates

## [2.2.2] - 2025-11-26

### Fixed

- **True text streaming** - `streamText()` now streams text token-by-token instead of returning all text in a single chunk
  - Enabled SDK's `includePartialMessages` option by default in `doStream()`
  - Added handling for `stream_event` messages to extract `text_delta` events
  - Implemented deduplication to avoid duplicate text when assistant messages arrive with cumulative content
  - **Before**: 1 chunk, ~23 second wait before any text appeared
  - **After**: ~192 chunks, ~3.5 seconds to first chunk, ~12 chars average per chunk

### Changed

- Improved type safety by using SDK's `SDKPartialAssistantMessage` type instead of inline type assertions

## [2.2.0] - 2025-11-22

### Added

- **Native structured outputs** - `generateObject()` and `streamObject()` now use SDK's `outputFormat` option with guaranteed schema compliance via constrained decoding
- `supportsStructuredOutputs = true` - Provider now advertises native structured outputs support to AI SDK
- Proper error handling for `error_max_structured_output_retries` SDK response
- Export `OutputFormat` type from the SDK

### Changed

- **Upgraded Claude Agent SDK to ^0.1.50** - Now uses SDK's native structured outputs feature
- Simplified internal JSON handling - removed prompt-based JSON instructions in favor of SDK's `outputFormat`
- Removed internal `extractJson` utility and `jsonc-parser` dependency (internal implementation detail, not part of public API)
- **Breaking behavior change**: Schema-less `responseFormat: { type: 'json' }` is now treated as unsupported (matching Anthropic's official provider behavior). An `unsupported-setting` warning is emitted and the call is treated as plain text. Use a schema with `generateObject()`/`streamObject()` for guaranteed JSON output.

## [2.1.0] - 2025-10-20

### Added

- **Comprehensive debug logging and verbose mode** - Enhanced logging capabilities for better debugging and troubleshooting
  - Added `debug` and `info` log levels to complement existing `warn` and `error` levels
  - New `verbose` setting to control debug/info logging visibility
  - Detailed execution tracing including request/response flow, tool calls, stream events, and token usage
  - `createVerboseLogger()` utility that filters debug/info logs based on verbose mode
  - When `verbose: false` (default), only `warn` and `error` messages are logged
  - When `verbose: true`, all log levels including `debug` and `info` are logged
  - Comprehensive test coverage for all logging scenarios and custom logger implementations

### Potentially Breaking Changes

**Who is affected:** Only users with custom `Logger` implementations (estimated <5% of users).

**What changed:** The `Logger` interface now requires 4 methods instead of 2:

- `debug(message: string): void` - NEW - for detailed execution tracing (verbose mode only)
- `info(message: string): void` - NEW - for general flow information (verbose mode only)
- `warn(message: string): void` - existing
- `error(message: string): void` - existing

**Migration for custom logger users:**

```typescript
// Before (v2.0.x) ❌
const logger = {
  warn: (msg) => myLogger.warn(msg),
  error: (msg) => myLogger.error(msg),
};

// After (v2.1.0+) ✅
const logger = {
  debug: (msg) => myLogger.debug(msg), // Add this
  info: (msg) => myLogger.info(msg), // Add this
  warn: (msg) => myLogger.warn(msg),
  error: (msg) => myLogger.error(msg),
};
```

**Most users are unaffected:**

- Users without a custom logger (using default `console`) - no changes needed
- Users with `logger: false` - no changes needed
- The default logger automatically handles all log levels

### Fixed

- Corrected debug log message that was logging string length instead of message count
  - Was: `messagesPrompt.length` (string character count)
  - Now: `options.prompt.length` (actual message count)
  - Also added `hasImageParts` flag to the log for better visibility

### Changed

- **Default logger now includes level tags** - All log messages are prefixed with `[DEBUG]`, `[INFO]`, `[WARN]`, or `[ERROR]` for clarity
- Updated documentation with comprehensive logging and verbose mode examples
- Added integration tests for logger functionality in real provider usage scenarios
- Improved JSDoc comments for logger interface and functions

## [2.0.5] - 2025-10-19

### Fixed

- **Critical**: Fixed truncation detection false negatives in `isClaudeCodeTruncationError`
  - Removed incorrect position proximity check that compared JSON parser position (full payload) against assistant text length
  - Position comparison was comparing apples to oranges: parser position measures full JSON payload (~200+ chars) vs extracted text (~11 chars), causing `Math.abs(position - bufferedText.length) <= 16` to almost always fail
  - This bug prevented the graceful truncation recovery path from ever running, causing all truncations to throw errors instead of returning buffered text
  - Now relies solely on truncation indicator patterns and minimum content length (512 chars) for accurate detection
  - Simplified logic removes unnecessary `hasUnclosedJsonStructure` helper and `POSITION_PATTERN` regex
  - Added comprehensive documentation explaining why position checks are not feasible with current SDK layer
  - Enhanced cross-runtime compatibility by checking error name for cross-realm SyntaxError instances
  - Added additional truncation indicator patterns: "unexpected eof", "end of file", "unterminated string constant"

### Changed

- Improved documentation in `isClaudeCodeTruncationError` function explaining truncation detection strategy
- Lowered minimum truncation length threshold from 1024 to 512 characters for better recovery on shorter responses
- Updated warning message to reference "SDK" instead of "CLI" for consistency with v2.x terminology
- Clarified that content length is measured in UTF-16 code units, not byte length

## [2.0.4] - 2025-10-19

### Added

- Full support for Zod 4.x while maintaining backward compatibility with Zod 3.x
- New comprehensive Zod 4 compatibility test suite (`examples/zod4-compatibility-test.ts`)
- Added `example:zod4` npm script to run Zod 4 compatibility tests

### Changed

- Updated function schema validation to use version-agnostic `refine()` approach for maximum compatibility
- Upgraded development dependency from Zod 3.25.76 to Zod 4.1.12
- Updated README.md with Zod compatibility documentation

### Fixed

- Fixed Zod 4 compatibility issue in `claudeCodeSettingsSchema` validation
- Fixed overly restrictive password regex in `generate-object-constraints.ts` example
- Package now works seamlessly with both Zod 3.x and Zod 4.x installations
- Tool calls for built-in tools (Bash, Read, Write, etc.) no longer marked as invalid (#63)
  - Added `dynamic: true` flag to all tool stream parts (tool-input-start, tool-call, tool-result, tool-error)
  - AI SDK now correctly treats Claude Code's built-in tools as dynamic provider-executed tools
  - Eliminates `NoSuchToolError` and `invalid: true` flags without requiring user action
  - Transparent fix - no code changes required from users

## [2.0.3] - 2025-10-16

### Added

- Support for Claude 4.5 Haiku model (`haiku`) - Available in Claude Code v2.0.17+ (#59)

### Fixed

- Improved truncation detection to avoid false positives on malformed JSON (#60)
  - Added multi-layered validation: position-based, structure validation, minimum size guard, and truncation indicators
  - Prevents genuine JSON syntax errors from being incorrectly treated as CLI truncation events
- Updated `MinimalCallToolResult` type to match MCP SDK specification (#60)
  - Added missing `resource_link` content type
  - Split resource type into text/blob variants with proper discriminated unions
  - Resolves TypeScript compilation errors in downstream projects using MCP SDK v1.13+

### Changed

- Updated `@anthropic-ai/claude-agent-sdk` from `^0.1.0` to `^0.1.20`
- Updated all example files to use `haiku` model for faster execution
- Updated Quick Start examples in README.md to use `haiku` model
- Updated model version references to Sonnet 4.5 and Opus 4.1 in documentation

## [2.0.2] - 2025-10-02

### Changed

- Updated README.md npm tag documentation from `v1` to `v1-claude-code-sdk` (#56)
- Added explicit installation examples for all versions (v2.x, v1.x, v0.x)

## [2.0.0] - 2025-10-02

### BREAKING CHANGES

#### Migrate to Claude Agent SDK

This release migrates from `@anthropic-ai/claude-code` to `@anthropic-ai/claude-agent-sdk`.

- System prompt is no longer applied by default.
  - Migration: set `systemPrompt: { type: 'preset', preset: 'claude_code' }` to restore the previous default.
- Filesystem settings (CLAUDE.md, settings.json) are not loaded by default.
  - Migration: set `settingSources: ['user','project','local']` to restore the previous default.
- All imports referring to the SDK should now use `@anthropic-ai/claude-agent-sdk`.

#### Legacy fields deprecated

- `customSystemPrompt` and `appendSystemPrompt` are deprecated in favor of `systemPrompt`.
  - For append-only behavior, use `{ type: 'preset', preset: 'claude_code', append: '<text>' }`.
  - In 2.x, these fields are mapped internally to `systemPrompt` for compatibility and may log a deprecation warning; they will be removed in 3.0.

### Changed

- Switched SDK dependency to `@anthropic-ai/claude-agent-sdk` and updated re-exports accordingly.
- Added support for Agent SDK `systemPrompt` (string or preset with optional `append`) and `settingSources`.
- Updated documentation and examples to reflect new defaults and migration steps.
- Streaming warning text updated to mention “Claude Agent SDK features …”.

### Notes

- Provider ID and `providerMetadata` keys remain `claude-code` for compatibility. This may change in a future major release.

## [1.1.3] - 2025-09-03

### Fixed

- Fixed `canUseTool` hanging issue when using streaming input by holding input stream open until Claude returns results (#43)

## [1.1.2] - 2025-08-28

### Added

- Provider-level streaming input support to enable `canUseTool` via the SDK's stream-json mode (`streamingInput: 'auto' | 'always' | 'off'`).
- Pass-through support for hooks and `canUseTool` to the Claude Code SDK (with guard against `permissionPromptToolName`).
- Re-exports for SDK MCP tool utilities: `createSdkMcpServer`, `tool`, and related hook/permission types.
- Helper `createCustomMcpServer` to simplify in-process MCP tool registration.
- Examples: hooks-callbacks and sdk-tools-callbacks.
- Documentation: new sections on Custom SDK Tools (callbacks) and Hooks/Runtime Permissions; clarified `canUseTool` streaming requirement and usage.

### Changed

- Updated README and GUIDE to reflect that `canUseTool` is supported when streaming input is enabled (no longer "blocked").

## [1.1.1] - 2025-08-25

### Fixed

- Added missing HTTP transport validation for MCP server configuration (#38)

## [1.1.0] - 2025-08-18

### Added

- Support for both Zod v3 and v4 (peer dependency now accepts `^3.0.0 || ^4.0.0`)
- Compatibility layer for Zod API differences between versions

### Fixed

- Function schema validation now works with both Zod v3 and v4
- Error handling supports both `error.errors` (v3) and `error.issues` (v4) formats
- Updated `z.record()` calls to specify both key and value types for v4 compatibility
- Improved URL validation hints in generate-object-constraints example
- Removed non-existent test-session.ts from run-all-examples.sh script

## [1.0.1] - 2025-08-15

### Changed

- Updated to stable AI SDK v5 (from v5-beta)
- Updated dependencies to stable versions:
  - `@ai-sdk/provider`: 2.0.0
  - `@ai-sdk/provider-utils`: 3.0.3
  - `@anthropic-ai/claude-code`: 1.0.81
  - `ai` (devDependency): 5.0.14
- Changed to fixed versioning for dependencies for better stability
- Removed beta references from documentation and package.json
- Updated package description to reflect stable v5 support

## [1.0.0-beta.1] - 2025-07-24

### Changed

- **BREAKING**: Complete rewrite for Vercel AI SDK v5-beta compatibility
- **BREAKING**: Now implements `LanguageModelV2` interface instead of `LanguageModelV1`
- **BREAKING**: Requires AI SDK v5-beta (`ai@^4.0.0` or later)
- **BREAKING**: New streaming API pattern - `streamText` returns result object with `textStream` async iterator
- **BREAKING**: Token usage properties renamed: `promptTokens` → `inputTokens`, `completionTokens` → `outputTokens`
- **BREAKING**: Message types changed to `ModelMessage` instead of `UIMessage`/`CoreMessage`
- **BREAKING**: No backwards compatibility with v0.x - use v0.x for AI SDK v4
- Updated all examples to use v5-beta patterns
- Added `stream-start` event emission in streaming responses
- Added proper `text-start` and `text-end` events for text parts
- Badge status changed from "alpha" to "beta"

### Added

- Version compatibility table in README
- Migration guide in `docs/ai-sdk-v5/` directory
- Support for v5's content-first message format
- Better TypeScript type safety with v5 types
- Schema passing for object generation via `responseFormat.schema`

### Fixed

- Stream response now includes all required v5 events
- Proper handling of message content as arrays of parts
- TypeScript strict mode compliance
- Object generation now properly uses schema information from responseFormat
- Fixed `result.text` hanging issue by implementing proper text-start/end events
- tool-management.ts example updated to use streaming pattern

### Note

Version 0.x releases continue on the [`ai-sdk-v4`](https://github.com/ben-vargas/ai-sdk-provider-claude-code/tree/ai-sdk-v4) branch for AI SDK v4 compatibility.

## [0.2.2] - 2025-06-20

### Changed

- Updated terminology from "Claude Code CLI" to "Claude Code SDK" throughout codebase
- Updated all documentation, comments, error messages, and examples to reflect SDK usage
- Clarified that the provider uses the SDK component from @anthropic-ai/claude-code

## [0.2.0] - 2025-06-19

### Added

- Configurable logger support with options to disable or customize warning/error output
- Integration tests for logger functionality
- Extended thinking support for Claude Opus 4 with examples

### Changed

- Improved JSON extraction algorithm for better performance and reliability
- JSON extraction now handles truncated JSON and missing closing braces
- Consolidated test structure - moved integration tests to `src/` directory
- Updated documentation to reflect accurate project structure
- Enhanced error messages for better debugging

### Fixed

- Resolved all ESLint errors and removed unused imports
- Fixed edge runtime compatibility issues with conditional fs imports
- Fixed error handling to properly use AI SDK error types
- Fixed validation to skip directory checks in non-Node environments

### Performance

- Optimized JSON extraction with early termination for invalid JSON
- Reduced JSON parsing overhead for large responses
- Improved streaming performance for object generation

## [0.1.0] - 2025-06-15

### Added

- Full ProviderV1 interface compliance with required methods (`textEmbeddingModel`, `chat`)
- `supportsImageUrls = false` flag to explicitly declare image limitations
- `supportsStructuredOutputs = false` for transparency about JSON-only support
- Response/request metadata with generateId() from provider-utils
- `response-metadata` stream part emitted when session is initialized
- Stream error handling - errors now emitted as stream parts
- Enhanced error handling using AI SDK error utilities
- Export of `ClaudeCodeLanguageModel` class for advanced use cases
- Verbose mode support in settings (for future CLI integration)
- Documentation of all unsupported AI SDK settings

### Changed

- Error handling now uses `createAPICallError` and `createAuthenticationError`
- Stream errors are emitted as error parts instead of thrown directly
- Updated README to document all limitations and unsupported settings

## [0.0.1] - 2025-06-15

### Changed

- **BREAKING**: Complete refactor to use official `@anthropic-ai/claude-code` SDK instead of spawn-based implementation (2025-06-14)
- **BREAKING**: Removed `timeoutMs` configuration in favor of standard AI SDK `AbortSignal` pattern
- Updated to meet all Vercel AI SDK community provider standards
- Implemented tsup build system for dual CJS/ESM distribution
- Enhanced object generation with JSON extraction for reliable structured output

### Added

- Dual format builds (CommonJS and ES Modules)
- Source maps for better debugging experience
- Separate vitest configurations for edge and node environments
- Provider metadata including sessionId, costUsd, durationMs, and rawUsage
- JSON extraction logic for reliable object generation
- Support for all Claude Code SDK options (MCP servers, tool management, etc.)
- Standard AI SDK error classes for better ecosystem compatibility
- Prevent misuse of provider factory with new keyword (2025-06-11)
- Validate maxConcurrentProcesses to prevent deadlock (2025-06-11)
- Abort-aware queue for efficient request cancellation (2025-06-10)

### Fixed

- Object generation now works reliably through prompt engineering and JSON extraction
- Session management properly uses message history pattern
- All examples updated to use SDK patterns correctly
- System message serialization in language model (2025-06-10)
- Tool permission behavior for empty arrays (2025-06-10)

### Removed

- Direct CLI spawn implementation
- `timeoutMs` configuration (use AbortSignal instead)
- References to old implementation patterns in examples
- Custom `ClaudeCodeError` class in favor of standard SDK errors

## [0.0.0] - 2025-06-08

### Initial Release

- Initial implementation of AI SDK provider for Claude Code SDK
- Support for Claude 4 Opus and Sonnet models
- Text generation (streaming and non-streaming)
- Basic object generation support
- Multi-turn conversations
- Error handling with custom ClaudeCodeError class
- TypeScript support
- Provider metadata including usage tracking
- Configurable timeout support
- Process pooling for concurrent requests
