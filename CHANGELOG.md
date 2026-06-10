# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.5.0] - 2026-06-10

This release upgrades the provider to `@anthropic-ai/claude-agent-sdk` 0.3.x (from 0.2.63) and closes the resulting capability gap in one pass: every non-excluded SDK `Options` field is now reachable as a first-class setting (enforced by a new compile-time drift guard), stream handling understands the new 0.3.x message types (refusal fallbacks, superseded messages, timing metadata), AI SDK conformance is tightened (honest warnings, tool-call history round-trip, an MCP bridge helper for AI SDK tools), and session lifecycle helpers, warm-start re-exports, and user-dialog support are exposed. A weekly canary CI job now tests against `@anthropic-ai/claude-agent-sdk@latest` to catch upstream drift early.

### Added

- **`CLAUDE_AGENT_SDK_CLIENT_APP` default** - The provider identifies itself to the Agent SDK (User-Agent) as `ai-sdk-provider-claude-code/<version>` unless the variable is already set via the process environment, the `env` setting, or `sdkOptions.env`.
- **New error mappings for SDK 0.3.x error kinds** - `overloaded` maps to a retryable `APICallError`, `model_not_found`/`no such model` map to a non-retryable `APICallError` with a clear message, and `oauth_org_not_allowed` maps to the authentication error path (`LoadAPIKeyError`).
- **New SDK 0.3.x option passthroughs in `ClaudeCodeSettings`** - `skills` (`string[] | 'all'` single-switch skills enablement; no need to add `'Skill'` to `allowedTools`), `settings` (inline `Settings` object or settings file path), `managedSettings` (restrictive policy-tier settings), `toolAliases` (map built-in tool names to replacement tools), `toolConfig` (per-tool configuration), `planModeInstructions`, `title`, `forwardSubagentText`, `agentProgressSummaries`, and `includeHookEvents`.
- **Alpha option passthroughs** (marked `@alpha`, subject to upstream change) - `taskBudget` (`{ total: number }`), `sessionStore`, `sessionStoreFlush` (`'batched' | 'eager'`), and `loadTimeoutMs`. Combining `sessionStore` with `persistSession: false` (transcript mirroring requires local session writes), with `enableFileCheckpointing: true` (checkpoint backup blobs are not mirrored, so `rewindFiles()` fails after a store-backed resume), or with `continue: true` when the store lacks `listSessions()` and no `resume` ID is given (the SDK needs `listSessions()` to discover the most recent session) is rejected at validation time per SDK constraints.
- **New SDK re-exports** - Types `EffortLevel`, `Settings`, `ToolConfig`, `AgentDefinition`, `SessionStore`, `SessionStoreFlush` and values `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`, `InMemorySessionStore`.
- **Timing metadata in `providerMetadata['claude-code']`** - `ttftMs` (time to first token), `ttftStreamMs`, `timeToRequestMs`, and `terminalReason` are now exposed alongside the existing `costUsd`/`durationMs`/`modelUsage` when present on the SDK result message (both `doGenerate` and `doStream`).
- **`apiRetries` in `providerMetadata['claude-code']`** - API retry messages (`api_retry`) are debug-logged and counted; the total appears in providerMetadata when greater than zero.
- **`permissionDenials` in `providerMetadata['claude-code']`** - Auto-denied tool calls (`permission_denied` messages) are warn-logged and recorded as `{ toolName, reason? }` entries, so denials are visible without waiting for the model to mention them.
- **`onPromptSuggestion` callback in `ClaudeCodeSettings`** - Receives the predicted next user prompt when `promptSuggestions: true`. The suggestion arrives after the `result` message (post-finish), which is why it is delivered via callback instead of `providerMetadata`. The post-result drain is bounded: it stops after the first suggestion (the SDK emits at most one per turn) and times out after 10s so a lingering CLI cannot hold the subprocess open indefinitely.
- **`estimatedThinkingTokens` in `providerMetadata['claude-code']`** - Live `thinking_tokens` estimates from the redacted-thinking phase are accumulated (per-frame deltas summed across thinking blocks) and surfaced when greater than zero. The SDK documents the estimate as not being the authoritative billed output tokens, so it is deliberately surfaced as metadata instead of feeding `usage.outputTokens.reasoning`.
- **Explicit handling for SDK 0.3.x stream messages** - `model_refusal_fallback` and superseding assistant messages are debug-logged, and refusal-fallback retractions are honored in both modes: `doGenerate` drops retracted text and thinking segments so only kept content plus the canonical replacement is returned, and `doStream` retracts only the superseded segments from its accumulators and (when the replacement was not already delivered via stream events) closes the open text part and emits the replacement as a new text part - the already-streamed refused text cannot be un-streamed, but the model's actual answer is never dropped. The informational subtypes `notification`, `status` (including `'requesting'` and compaction results), `task_updated`, `session_state_changed`, `commands_changed`, `memory_recall`, `plugin_install`, and `mirror_error` are intentionally debug-logged and ignored via a single consolidated code path.
- **New hook/type re-exports** - Every member of the SDK `HookInput` union (30 hook event input types, including `PostToolUseFailureHookInput`, `NotificationHookInput`, `StopHookInput`, `SubagentStartHookInput`, `SubagentStopHookInput`, `PreCompactHookInput`, `PermissionRequestHookInput`, `SetupHookInput`, `ElicitationHookInput`, `ElicitationResultHookInput`, `ConfigChangeHookInput`, `WorktreeCreateHookInput`, and `WorktreeRemoveHookInput`), the `HookJSONOutput` union members `AsyncHookJSONOutput`/`SyncHookJSONOutput` and all 20 `*HookSpecificOutput` payload types, plus `HookPermissionDecision` (adds `'defer'`), `SDKMessageOrigin`, and `TerminalReason`. The `HOOK_EVENTS` runtime const (value-level companion to the `HookEvent` type) is also re-exported.
- **More SDK type re-exports used by the public surface** - `Options` (the SDK `query()`/`startup()` options shape referenced by `systemPrompt`/`tools`/`sdkOptions`), `SDKMessage`/`SDKUserMessage` (needed to type `Query` iteration, `Query.streamInput()`, and `WarmQuery.query()`), the `Query` method result shapes (`SlashCommand`, `ModelInfo`, `AgentInfo`, `AccountInfo`, `McpServerStatus`, `RewindFilesResult`, `McpSetServersResult`), `PermissionMode` and `PermissionUpdateDestination` (referenced by every `PermissionUpdate` variant), `SdkBeta`/`SdkPluginConfig`/`SandboxSettings` (plus `SandboxNetworkConfig`, `SandboxFilesystemConfig`, `SandboxIgnoreViolations`), the `McpServerConfig` union members (`McpStdioServerConfig`, `McpSSEServerConfig`, `McpHttpServerConfig`, `McpSdkServerConfig`) and `McpServerConfigForProcessTransport` (per-agent MCP server map values), and the SDK's `AbortError` error class (relevant on the standalone warm-start path where SDK errors propagate unwrapped).
- **Context usage documentation** - README documents how to call `query.getContextUsage()` via the existing `onQueryCreated` callback (the provider deliberately does not auto-fetch it). The call must happen while the query is still live — e.g. from a `Stop` hook during the turn — because the CLI subprocess has exited by the time `generateText`/`streamText` resolves and a later call rejects.
- **Warnings for silently-dropped call options** - `tools`, `toolChoice` (other than `'auto'`), and `maxOutputTokens` now emit `unsupported` warnings instead of being silently ignored. The Claude Code CLI executes its own tools, so AI SDK tools cannot be auto-bridged at the provider layer; the `tools` warning points to the `createAiSdkMcpServer` helper and the `mcpServers`/`allowedTools` settings.
- **`createAiSdkMcpServer(name, tools)` helper** - Bridges AI SDK tool definitions (the `ai` package's `tool()` helper) into an in-process SDK MCP server for the `mcpServers` setting. Automatic bridging via the AI SDK `tools` option is impossible at the provider layer (providers only receive tool declarations; `execute` lives in the `ai` package layer), so this is the explicit alternative. String results pass through as MCP text content, other results are `JSON.stringify`'d, and thrown errors become `isError` tool results instead of crashing the CLI session. Requires a Zod object schema and an `execute` function on every tool — `jsonSchema()`-based or execute-less tools throw at creation time. Also exports the structural `AiSdkLikeTool`/`AiSdkToolExecuteOptions` types (no dependency on the `ai` package), adds a "Using AI SDK Tools" README section, and ships a runnable `examples/ai-sdk-tools.ts` (`npm run example:ai-sdk-tools`).
- **Warm-start re-exports (`startup` / `WarmQuery`)** - The SDK's `startup()` helper pre-spawns the CLI subprocess and completes its initialize handshake, returning a `WarmQuery` handle whose `query()` writes the prompt to the ready process (no startup latency). Note the documented limitation: a `WarmQuery` is a standalone SDK query path (its `query()` returns the SDK `Query` directly, once per handle) and the SDK exposes no option for handing a pre-warmed process to a regular `query()` call, so warm start cannot accelerate `generateText`/`streamText` requests made through this provider. The README section "Reducing time-to-first-token (warm start)" documents the standalone usage pattern.
- **`warmSpareClaimed` in `providerMetadata['claude-code']`** - Surfaced (both `doGenerate` and `doStream`) when the SDK result message reports whether the query was served from a pre-warmed spare CLI process; `false` is surfaced too, so consumers can distinguish "reported as not claimed" from "not reported".
- **`onUserDialog` and `supportedDialogKinds` settings** - Passthroughs for the SDK's blocking user-dialog handling (`request_user_dialog` control requests, e.g. `'refusal_fallback_prompt'`). The SDK fails closed around dialogs: a dialog kind not declared in `supportedDialogKinds` is never emitted and the dialog-gated flow degrades to its no-dialog behavior, and providing the callback alone does not opt the consumer in. `supportedDialogKinds` requires `onUserDialog` (the SDK throws on a non-empty list without the callback); the provider emits a validation warning for that combination. Types `OnUserDialog`, `UserDialogRequest`, and `UserDialogResult` are re-exported.
- **`permissionMode: 'auto'`** - The new SDK 0.3.x permission mode is accepted by settings validation and documented in the README permission-mode row. `'delegate'` was removed in SDK 0.3.x — the bundled CLI rejects `--permission-mode delegate` at argv parsing — so the provider now rejects it at validation time (in both the `ClaudeCodeSettings` type and the Zod enum) instead of letting every query fail at spawn time.
- **`PermissionDecisionClassification` re-export and permission docs** - `PermissionResult` (both branches) gained an optional `decisionClassification` (`'user_temporary' | 'user_permanent' | 'user_reject'`), and the `canUseTool` callback now receives optional `title`/`displayName`/`description` fields for rendering permission prompts — both are type-level SDK additions documented in the README (no provider code change needed).
- **Permission hooks example** - `examples/hooks-permission-denied.ts` (`npm run example:hooks-permissions`) demonstrates a `PreToolUse` hook returning the SDK 0.3.x `permissionDecision: 'defer'` (handing the decision back to the permission system) and a `PermissionDenied` hook observing tools auto-denied without a prompt.
- **Session lifecycle helper re-exports** - `listSessions`, `forkSession`, `getSessionInfo`, `getSessionMessages`, `deleteSession`, `renameSession`, `tagSession`, `listSubagents`, `getSubagentMessages`, and the alpha `SessionStore` utilities `foldSessionSummary` and `importSessionToStore`, plus their option/result types (`ListSessionsOptions`, `ForkSessionOptions`, `ForkSessionResult`, `GetSessionInfoOptions`, `GetSessionMessagesOptions`, `GetSubagentMessagesOptions`, `ListSubagentsOptions`, `SessionMutationOptions`, `ImportSessionToStoreOptions`) and related shapes (`SDKSessionInfo`, `SessionMessage`, `SessionKey`, `SessionStoreEntry`, `SessionSummaryEntry`, `SessionCronSummary`). A new [docs/sessions.md](docs/sessions.md) guide ties the session settings (`sessionId`, `resume`, `resumeSessionAt`, `forkSession`, `continue`, `persistSession`, `title`) together with the helpers — including which operate on `~/.claude/projects/` disk storage vs a custom `SessionStore`, and the `title` setting vs `renameSession()` relationship — and a runnable `examples/session-management.ts` (`npm run example:sessions`) walks the create → resume → fork → inspect → delete lifecycle.
- **Compile-time SDK Options drift guard** - `src/options-coverage.test.ts` partitions `keyof Options` into mapped, provider-managed, and consciously-excluded buckets and fails `typecheck` with the offending key's name whenever a new SDK release adds an `Options` field this provider neither maps nor excludes (and, in reverse, when a listed key is removed upstream).
- **Weekly SDK canary workflow** - `.github/workflows/canary.yml` installs `@anthropic-ai/claude-agent-sdk@latest` (`--no-save`) every Monday (plus `workflow_dispatch`) and runs typecheck and unit tests, so upstream SDK drift surfaces as a clearly-labeled canary failure instead of a surprise during the next upgrade.
- **"Not exposed (and why)" README section** - Documents the consciously-unmapped `Options` fields (`agent`, `onElicitation`), the provider-managed fields, and why the SDK's alpha `/browser`, `/bridge`, and `/assistant` entry points are not re-exported. `docs/ai-sdk-v4/` and `docs/ai-sdk-v5/` are now explicitly marked as historical (legacy provider versions).
- **Early validation for more SDK/CLI runtime constraints** - Combinations the SDK or CLI rejects at query/spawn time are now caught up front: `sandbox` with a `settings` file path (inline `Settings` objects remain fine), `sessionId` values that are not valid UUIDs, `sessionId` combined with `continue`/`resume` without `forkSession: true`, `fallbackModel` equal to the main model (rejected in the model class before the SDK is invoked), and `plugins[].type` values other than `'local'` (the only type the SDK supports).

### Changed

- **Upgraded `@anthropic-ai/claude-agent-sdk` to `^0.3.170`** (from `^0.2.63`). Notable upstream changes handled by this provider:
  - **New peer dependencies** - The Agent SDK now requires `@anthropic-ai/sdk` (`>=0.93.0`) and `@modelcontextprotocol/sdk` (`^1.29.0`) as peer dependencies (auto-installed by npm 7+).
  - **Per-platform native binaries** - The Agent SDK now ships the Claude Code runtime as per-platform native binaries via `optionalDependencies` instead of a single bundled `cli.js`. Keep `optionalDependencies` enabled in Docker/CI installs.
  - **`settingSources` isolation preserved** - SDK 0.3.x changed the SDK default so that omitting `settingSources` loads ALL filesystem settings. The provider now explicitly passes `settingSources: []` when unset to preserve its documented isolation behavior. Set `settingSources` (or `sdkOptions.settingSources`) to opt in.
  - **Subprocess env semantics** - SDK 0.3.x treats `Options.env` as a full replacement for the subprocess environment (no longer merged with `process.env`). The provider now always constructs the subprocess environment from an expanded sanitizing allowlist: the platform basics (with `COMSPEC` newly added to the Windows set) plus prefix-matched `ANTHROPIC_*`, `CLAUDE_*`, `AWS_*`, `GOOGLE_*` variables, proxy/TLS variables (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, lowercase variants, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `SSL_CERT_DIR`), and `GCLOUD_PROJECT`/`CLOUD_ML_REGION`. User-provided `env`/`sdkOptions.env` values still win, and explicit `undefined` removes a variable.
  - **Workarounds re-validated** - The mid-stream JSON truncation shim and the input-stream-held-open workaround (anthropics/claude-code#4775) were re-validated against SDK 0.3.170 on 2026-06-09 and remain in place as defensive measures.
- **`effort` now uses the SDK's exported `EffortLevel` type** - Replaces the hand-rolled union and adds the new `'xhigh'` level.
- **`systemPrompt` widened to the SDK's full shape** - Now also accepts `string[]` (include the re-exported `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` marker as a standalone element to split the static, cross-session-cacheable prefix from the dynamic suffix) and `excludeDynamicSections` on the `claude_code` preset form. The legacy `customSystemPrompt`/`appendSystemPrompt` mapping is unchanged.
- **`agents` now uses the SDK's `AgentDefinition` type directly** - Replaces the inline re-declaration, picking up `effort`, `permissionMode`, `background`, `memory`, `initialPrompt`, `skills`, `maxTurns`, and full model ID strings (validation now accepts any string `model`, not just `'sonnet' | 'opus' | 'haiku' | 'inherit'`; values that look like neither a known alias nor a full model ID still produce a validation warning to catch typos early).
- **`fallbackModel` docs** - Now documented as accepting a comma-separated list of fallback models tried in order.
- **Tool-call history round-trip** - Assistant tool calls in replayed conversation history are now serialized faithfully, one line per call (`[Tool call: Read({"file_path":"/x"})]`, inputs truncated at 1000 characters with a `...[truncated]` suffix), pairing with the existing `Tool Result (name): ...` lines. Previously all tool calls collapsed to a literal `[Tool calls made]` placeholder, losing tool context on multi-turn replay.

### Fixed

- **`thinking.display` accepted** - SDK 0.3.x added an optional `display?: 'summarized' | 'omitted'` field to `ThinkingAdaptive` and `ThinkingEnabled`; the strict Zod thinking schema now accepts it instead of rejecting a config the package's own re-exported types allow.
- **`sessionId` no longer forwarded on auto-resumed turns** - A model instance configured with a custom `sessionId` used to send the CLI-forbidden `--resume` + `--session-id` combination on the second turn of a multi-turn conversation (the provider auto-resumes via the captured session ID). `sessionId` is now only forwarded while no resume target exists, or when `forkSession: true` is set (it then names the fork's ID).
- **doStream supersedes retraction no longer requires replacement text** - Superseded segments are now evicted from the text accumulators on arrival of the superseding assistant message (matching `doGenerate`), even when the canonical replacement carries no text blocks (e.g. tool_use-only), so retracted text can no longer resurface through the JSON-mode or truncation fallback paths.
- **`'fable'` recognized as a known model alias** - The model-ID and `agents[].model` typo warnings no longer flag `'fable'`, which the SDK documents as a valid alias.

### Planned for 4.0.0

Deferred breaking cleanups, collected here for visibility:

- Remove the deprecated `customSystemPrompt` and `appendSystemPrompt` settings (superseded by the `systemPrompt` union).
- Remove the deprecated `maxThinkingTokens` setting (superseded by `thinking`).
- Possibly remove `executable`/`executableArgs` if the SDK's per-platform native binaries make them effective no-ops for the bundled runtime.

## [3.4.4] - 2026-03-10

### Fixed

- **Interrupted text blocks** - Prevent duplicate `text-end` events when a text block is closed early by a tool-use block, reasoning block, or assistant tool message before its later `content_block_stop` arrives.

## [3.4.3] - 2026-03-02

### Added

- **`thinking` setting** - First-class `ThinkingConfig` support (`adaptive`, `enabled` with optional `budgetTokens`, `disabled`). Takes precedence over the deprecated `maxThinkingTokens`.
- **`effort` setting** - Control how much effort Claude puts into its response (`low`, `medium`, `high`, `max`).
- **`promptSuggestions` setting** - Enable prompt suggestions from the agent after each turn.
- **Reasoning content parts** - `doGenerate` now extracts thinking blocks as AI SDK `reasoning` content parts, and exposes `thinkingTraces` in `providerMetadata` for convenience access.
- **Re-exported types** - `ThinkingConfig`, `ThinkingAdaptive`, `ThinkingEnabled`, `ThinkingDisabled` are now exported from the package entry point.
- **Thinking traces example** - Added `examples/thinking-traces.ts` demonstrating reasoning access in both streaming and non-streaming modes.

### Changed

- **Bumped `@anthropic-ai/claude-agent-sdk`** to `^0.2.63`.
- **DRY content-block extraction** - Shared `isContentBlock` guard and `filterContentBlocks` utility replace duplicated filter logic in `extractToolUses`, `extractToolResults`, and `extractToolErrors`.

### Fixed

- **Empty-string content blocks** - Fixed truthy bug where empty-string `text` or `thinking` content was silently dropped.
- **Strict thinking schema validation** - Thinking union variants now use `.strict()` to reject invalid extra keys (e.g. `{ type: 'adaptive', budgetTokens: 1000 }`).

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
