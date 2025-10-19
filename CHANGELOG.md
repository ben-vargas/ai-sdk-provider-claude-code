# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.2] - 2025-10-19

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
- Updated warning message to reference "SDK" instead of "CLI" for consistency
- Clarified that content length is measured in UTF-16 code units, not byte length

## [1.2.1] - 2025-10-19

### Fixed

- Add `dynamic: true` flag to built-in tool declarations to prevent AI SDK v3 validation errors. Claude Code's built-in tools (Bash, Read, Write, etc.) are now correctly recognized as dynamic provider-executed tools, eliminating `NoSuchToolError` and `invalid: true` flags when used with AI SDK v3. This fix is transparent to users - no code changes required. (Backport from v2.0.4)
- Improve truncation detection to avoid false positives on malformed JSON. Implements multi-layered truncation detection with position-based validation, JSON structure validation, minimum size guard (1KB), and truncation indicator checks. This prevents normal JSON syntax errors from being incorrectly treated as CLI truncation events. When truncation is detected, the response includes `finishReason: 'length'`, a warning message, and `truncated: true` in provider metadata. (Backport from v2.0.3)

### Added

- Zod 4 compatibility example (`examples/zod4-compatibility-test.ts`) demonstrating all Zod 4 features including new function schema API, discriminated unions, and validation patterns

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
