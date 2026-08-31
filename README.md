<p align="center">
  <img src="https://img.shields.io/badge/status-stable-00A79E" alt="stable status">
  <a href="https://www.npmjs.com/package/ai-sdk-provider-claude-code"><img src="https://img.shields.io/npm/v/ai-sdk-provider-claude-code?color=00A79E" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/ai-sdk-provider-claude-code"><img src="https://img.shields.io/npm/unpacked-size/ai-sdk-provider-claude-code?color=00A79E" alt="install size" /></a>
  <a href="https://www.npmjs.com/package/ai-sdk-provider-claude-code"><img src="https://img.shields.io/npm/dy/ai-sdk-provider-claude-code.svg?color=00A79E" alt="npm downloads" /></a>
  <a href="https://nodejs.org/en/about/releases/"><img src="https://img.shields.io/badge/node-%3E%3D22-00A79E" alt="Node.js ≥ 22" /></a>
  <a href="https://www.npmjs.com/package/ai-sdk-provider-claude-code"><img src="https://img.shields.io/npm/l/ai-sdk-provider-claude-code?color=00A79E" alt="License: MIT" /></a>
</p>

# AI SDK Provider for Claude Agent SDK

> **Latest Release**: Version 4.x supports AI SDK v7 stable with the Claude Agent SDK. Version 3.x moves to maintenance for AI SDK v6 under the `ai-sdk-v6` tag.

**ai-sdk-provider-claude-code** lets you use Claude via the [Vercel AI SDK](https://sdk.vercel.ai/docs) through the official `@anthropic-ai/claude-agent-sdk` and the Claude Code CLI.

## Version Compatibility

| Provider Version | AI SDK Version | Underlying SDK                   | NPM Tag              | Status      | Branch      |
| ---------------- | -------------- | -------------------------------- | -------------------- | ----------- | ----------- |
| 4.x.x            | v7             | `@anthropic-ai/claude-agent-sdk` | `latest`             | Stable      | `main`      |
| 3.x.x            | v6             | `@anthropic-ai/claude-agent-sdk` | `ai-sdk-v6`          | Maintenance | `ai-sdk-v6` |
| 2.x.x            | v5             | `@anthropic-ai/claude-agent-sdk` | `ai-sdk-v5`          | Legacy      | `ai-sdk-v5` |
| 1.x.x            | v5             | `@anthropic-ai/claude-code`      | `v1-claude-code-sdk` | Legacy      | `v1`        |
| 0.x.x            | v4             | `@anthropic-ai/claude-code`      | `ai-sdk-v4`          | Legacy      | `ai-sdk-v4` |

Install commands for each line are listed under [Installation](#installation) below.

## Zod Compatibility

**The 4.x line requires Zod `^4.1.8`.** Version 3.x remains available for AI SDK v6 under the `ai-sdk-v6` tag.

```bash
npm install ai-sdk-provider-claude-code ai zod@^4.1.8
```

> **Note:** Zod 3 support was dropped in v3.2.0 due to the underlying `@anthropic-ai/claude-agent-sdk@0.2.x` requiring Zod 4. If you need Zod 3 support, use `ai-sdk-provider-claude-code@3.1.x`.

## Installation

### 1. Install and authenticate the CLI

See the [official docs](https://docs.anthropic.com/en/docs/claude-code/overview) for platform-specific options.

```bash
curl -fsSL https://claude.ai/install.sh | bash
claude auth login
```

### 2. Add the provider

```bash
# For AI SDK v7 (4.x; current latest tag)
npm install ai-sdk-provider-claude-code ai

# For AI SDK v6 maintenance (3.x)
npm install ai-sdk-provider-claude-code@ai-sdk-v6 ai@^6.0.0

# For AI SDK v5
npm install ai-sdk-provider-claude-code@ai-sdk-v5 ai@^5.0.0

# For AI SDK v4 (legacy)
npm install ai-sdk-provider-claude-code@ai-sdk-v4 ai@^4.3.16
# or use a specific version: npm install ai-sdk-provider-claude-code@^0.2.2
```

## Disclaimer

**This is an unofficial community provider** and is not affiliated with or endorsed by Anthropic or Vercel. By using this provider:

- You understand that your data will be sent to Anthropic's servers through the Claude Agent SDK
- You agree to comply with [Anthropic's Terms of Service](https://www.anthropic.com/legal/consumer-terms)
- You acknowledge this software is provided "as is" without warranties of any kind

Please ensure you have appropriate permissions and comply with all applicable terms when using this provider.

## Quick Start

### AI SDK v7 (`latest`)

```typescript
// npm install ai-sdk-provider-claude-code ai
import { streamText } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';

const result = streamText({
  model: claudeCode('haiku'),
  prompt: 'Hello, Claude!',
});

const text = await result.text;
console.log(text);
```

### AI SDK v6 (maintenance)

```typescript
// npm install ai-sdk-provider-claude-code@ai-sdk-v6 ai@^6.0.0
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

### Version 4.0.0 (AI SDK v7)

This release ports the provider to AI SDK v7 / `LanguageModelV4`, adds first-class Claude Agent SDK callback, query-controller, MCP, and image support, and keeps the v7 support boundaries explicit:

- Requires Node.js ≥ 22 and Zod `^4.1.8`
- ESM-only package output; CommonJS `require()` is no longer available
- Tool failures now use spec `tool-result` parts/events with `isError: true` instead of the provider-specific `tool-error` stream extension

### Optional AI SDK v7 surfaces not implemented

Version 4.0.0 intentionally keeps optional provider surfaces absent unless the Claude Agent SDK has a durable provider-reference mapping:

- `ProviderV4.files()` is not implemented yet. The AI SDK interface uploads `{ type: 'data' }` or `{ type: 'text' }` bytes and returns a reusable provider reference, but Claude Agent SDK `0.3.251` exposes no direct upload/reuse API for that contract. This provider forwards inline **image** file parts in prompts; non-image inline files (for example PDFs) emit an unsupported-file call warning and are not forwarded. It does not upload files into durable provider references.
- Canonical V4 tool-result file parts are replayed into conversation history as text markers like `[File <name>: <mediaType>]`; raw file bytes are not re-sent on replay. Richer tool-result file replay, such as re-sending actual image/file bytes for tool-result file parts, is deferred.
- `ProviderV4.skills()` is not implemented yet. Claude Code skills are loaded from configured user/project/local skill directories with the existing `skills` setting below; there is no Agent SDK API that uploads a skill bundle and returns an AI SDK provider reference.
- Workflow serialization is deferred. `@ai-sdk/provider-utils@5.0.27` exposes `WORKFLOW_SERIALIZE`, `WORKFLOW_DESERIALIZE`, and `serializeModelOptions()` for provider model classes in the AI SDK v7 stack, but this provider has not added a serialization contract for provider instances or settings. Callback/function settings such as `canUseTool`, hooks, `logger`, `spawnClaudeCodeProcess`, and `SessionStore` methods are not JSON-serializable and must be recreated by the application.
- V4 `custom` and `reasoning-file` parts are not emitted as provider output yet. Claude Agent SDK `0.3.251` has no durable reasoning-file artifact output that maps to AI SDK `reasoning-file`; assistant-history `custom` and `reasoning-file` parts have no Claude Code replay representation and are skipped (unknown unsupported content variants still warn).

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

- **`fable`** - Claude Fable (most capable)
- **`opus`** - Claude Opus (highly capable)
- **`sonnet`** - Claude Sonnet (balanced performance)
- **`haiku`** - Claude Haiku (fastest, most cost-effective)

You can also use full model identifiers directly (e.g., `claude-fable-5`, `claude-sonnet-4-6`, `claude-opus-4-8`).

## Documentation

- **[Session Management](docs/sessions.md)** - Creating, resuming, forking, inspecting, and deleting sessions
- **[Examples](examples/)** - Sample scripts and patterns
- **[Usage Guide](docs/ai-sdk-v5/GUIDE.md)** - Comprehensive examples and configuration (written for provider 2.x / AI SDK v5; most patterns still apply)
- **[Troubleshooting](docs/ai-sdk-v5/TROUBLESHOOTING.md)** - Common issues and solutions (written for provider 2.x / AI SDK v5)
- **[Tool Streaming Support](docs/ai-sdk-v5/TOOL_STREAMING_SUPPORT.md)** - Event semantics and performance notes (written for provider 2.x / AI SDK v5)
- **[Breaking Changes](docs/ai-sdk-v5/V5_BREAKING_CHANGES.md)** - v0.x to v1.x migration guide (historical)

The `docs/ai-sdk-v4/` and `docs/ai-sdk-v5/` directories cover legacy provider versions (0.x and 1.x–2.x respectively) and are kept for reference.

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
curl -fsSL https://claude.ai/install.sh | bash
claude auth login
```

### Migrating from v1.x to v2.0.0

If you're upgrading from version 1.x:

1. **Update the package**: `npm install ai-sdk-provider-claude-code@ai-sdk-v5`
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

This provider supports **native structured outputs** via Claude Agent SDK constrained decoding. On the 4.x line (AI SDK v7), use `generateText()` with an `output` specification such as `Output.object({ schema })`, then destructure `output` from the result. For streaming structured output, use `streamText()` with the same `output` setting and read `partialOutputStream` as partial objects arrive.

```typescript
import { generateText, Output } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';
import { z } from 'zod';

const UserProfileSchema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().describe('Email address (validate client-side)'),
});

const { output } = await generateText({
  model: claudeCode('sonnet'),
  output: Output.object({ schema: UserProfileSchema }),
  prompt: 'Generate a user profile for a software developer',
});

console.log(output); // Matches the schema above
// { name: "Alex Chen", age: 28, email: "alex@example.com" }
```

**Benefits:**

- ✅ **Schema compliance (supported features)** - Constrained decoding ensures valid output
- ✅ **No JSON parsing errors** - AI SDK handles validation against your schema
- ✅ **No prompt engineering** - Schema enforcement is native to the SDK
- ✅ **Better performance** - No retry/extraction logic needed

> **Note:** Schema-less JSON output (AI SDK v7 `Output.json()`) is not supported by Claude Code; use `Output.object()` / `Output.array()` / `Output.choice()` with a schema or choices. The provider emits a V4 `unsupported` warning with `feature: 'responseFormat'` and treats the call as plain text.
>
> **Current CLI limitation:** Some JSON Schema features can cause the Claude Code CLI to silently fall back to prose (no `structured_output`). The provider mitigates the most common case: `format` keywords (`date-time`, `email`, `uri`, `uuid`, ... — produced by Zod's `.datetime()`, `.email()`, `.url()`, `.uuid()`) are stripped client-side before the schema is sent, with the hint folded into the field's `description` (e.g., `(expected format: email)`). Server-side enforcement of `format` still does not exist in the CLI, but the AI SDK validates `output` against your original Zod schema client-side, so nothing is lost. Complex regex `pattern`s (lookaheads/backreferences) remain unmitigated — `pattern` is passed through untouched because the CLI genuinely rejects some patterns. Keep generation schemas simple and enforce stricter invariants after generation.
>
> If you are staying on the 3.x (AI SDK v6) line, its legacy structured-output examples may still use `generateObject()` / `streamObject()`; new 4.x code should use `generateText()` / `streamText()` with `Output`.

## Core Features

- 🚀 Vercel AI SDK compatibility
- 🔄 Streaming support
- 💬 Multi-turn conversations
- 🎯 Native structured outputs with schema compliance for supported features
- 🛑 AbortSignal support
- 🔧 Tool management (MCP servers, permissions)
- 🧩 Callbacks (`onSdkMessage`, task/hook/MCP status events, `canUseTool`, `onElicitation`)
- 🎛️ Query controller access for safe live-session controls

## AI SDK v7 app-level features

DevTools and OpenTelemetry/OTel telemetry registration are app-level `ai` package features. This provider exposes standard AI SDK v7 metadata and stream parts for them, but adds no runtime dependencies for DevTools or OTel.

## Agent SDK Options (Advanced)

This provider exposes Agent SDK options directly. Key options include:

| Option                            | Description                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `betas`                           | Enable beta features (e.g., `['context-1m-2025-08-07']`)                                                                                                                                                                                                                                                                                                                |
| `sandbox`                         | Configure sandbox behavior (`{ enabled: true }`). Cannot be combined with a `settings` file path (inline `settings` objects are fine)                                                                                                                                                                                                                                   |
| `plugins`                         | Load custom plugins from local paths                                                                                                                                                                                                                                                                                                                                    |
| `resumeSessionAt`                 | Resume session at a specific message UUID                                                                                                                                                                                                                                                                                                                               |
| `resumeDropsTurn`                 | When resuming, drop the turn at a chain-entry UUID                                                                                                                                                                                                                                                                                                                      |
| `enableFileCheckpointing`         | Enable file rewind support                                                                                                                                                                                                                                                                                                                                              |
| `maxBudgetUsd`                    | Maximum budget in USD for the query                                                                                                                                                                                                                                                                                                                                     |
| `tools`                           | Tool configuration (array of names or preset)                                                                                                                                                                                                                                                                                                                           |
| `allowDangerouslySkipPermissions` | Allow bypassing permissions                                                                                                                                                                                                                                                                                                                                             |
| `persistSession`                  | When `false`, disables session persistence to disk (v3.2.0+)                                                                                                                                                                                                                                                                                                            |
| `spawnClaudeCodeProcess`          | Custom process spawner for VMs/containers (v3.2.0+)                                                                                                                                                                                                                                                                                                                     |
| `permissionMode`                  | Permission mode: `'default'`, `'acceptEdits'`, `'bypassPermissions'`, `'plan'`, `'dontAsk'`, `'auto'` (`'auto'` and `'dontAsk'` added in SDK 0.3.x; `'delegate'` was removed in SDK 0.3.x and the CLI rejects it, so the provider rejects it at validation time)                                                                                                        |
| `sessionId`                       | Use a specific session ID for deterministic tracking and correlation (v3.4.0+). Must be a valid UUID; cannot be combined with `continue`/`resume` unless `forkSession` is also set                                                                                                                                                                                      |
| `debug`                           | Enable programmatic debug logging from the SDK (v3.4.0+)                                                                                                                                                                                                                                                                                                                |
| `debugFile`                       | Path to a file for SDK debug log output (v3.4.0+)                                                                                                                                                                                                                                                                                                                       |
| `effort`                          | Effort level: `'low'`, `'medium'`, `'high'`, `'xhigh'`, or `'max'`                                                                                                                                                                                                                                                                                                      |
| `thinking`                        | Thinking config: `{ type: 'adaptive' }`, `{ type: 'enabled', budgetTokens?: number }`, or `{ type: 'disabled' }`                                                                                                                                                                                                                                                        |
| `promptSuggestions`               | Enable prompt suggestions (`boolean`)                                                                                                                                                                                                                                                                                                                                   |
| `skills`                          | Enable skills for the session: `'all'` or an array of skill names (v3.5.0+)                                                                                                                                                                                                                                                                                             |
| `settings`                        | Inline `Settings` object or path to a settings JSON file (v3.5.0+)                                                                                                                                                                                                                                                                                                      |
| `managedSettings`                 | Restrictive policy-tier settings enforced on the subprocess (v3.5.0+)                                                                                                                                                                                                                                                                                                   |
| `toolAliases`                     | Map built-in tool names to replacement tools, e.g. `{ Bash: 'mcp__workspace__bash' }` (v3.5.0+)                                                                                                                                                                                                                                                                         |
| `toolConfig`                      | Per-tool configuration for built-in tools, e.g. `{ askUserQuestion: { previewFormat: 'html' } }` (v3.5.0+)                                                                                                                                                                                                                                                              |
| `planModeInstructions`            | Custom workflow instructions for plan mode (v3.5.0+)                                                                                                                                                                                                                                                                                                                    |
| `title`                           | Custom title for a new session (v3.5.0+)                                                                                                                                                                                                                                                                                                                                |
| `forwardSubagentText`             | Forward subagent text/thinking blocks for nested transcripts (v3.5.0+)                                                                                                                                                                                                                                                                                                  |
| `agentProgressSummaries`          | Periodic AI-generated progress summaries for running subagents (v3.5.0+)                                                                                                                                                                                                                                                                                                |
| `includeHookEvents`               | Include hook lifecycle events in the output stream (v3.5.0+)                                                                                                                                                                                                                                                                                                            |
| `perTaskStopAffordance`           | Declare that your app renders per-task stop controls wired to `stopTask`, so an interrupt on a live open-input query spares background tasks (v4.2.0+). A capability assertion, not a toggle — see **Query controller access** below                                                                                                                                     |
| `fallbackModel`                   | Fallback model(s) if the primary is overloaded — accepts a comma-separated list to try in order. Must differ from the main model                                                                                                                                                                                                                                        |
| `onUserDialog`                    | Callback rendering blocking CLI dialogs (`request_user_dialog`); see **User dialogs** below                                                                                                                                                                                                                                                                             |
| `supportedDialogKinds`            | Dialog kinds your `onUserDialog` can render; required for dialogs to be emitted at all                                                                                                                                                                                                                                                                                  |
| `onSdkMessage`                    | Raw callback for every observed Agent SDK `SDKMessage`; useful for future SDK message types and custom telemetry                                                                                                                                                                                                                                                        |
| `onTaskEvent`                     | Callback for task/subagent lifecycle events (`ClaudeCodeTaskEvent`); also accumulated in `providerMetadata['claude-code'].taskEvents` when present                                                                                                                                                                                                                      |
| `onHookEvent`                     | Callback for hook lifecycle events (`ClaudeCodeHookEvent`); set `includeHookEvents: true` when you want the SDK to emit hook started/progress/response messages                                                                                                                                                                                                         |
| `onMcpStatusChange`               | Callback for the initial MCP status snapshot observed from the SDK init message (`ClaudeCodeMcpStatusEvent`); the same request-time snapshot is surfaced in `providerMetadata['claude-code'].mcpServers` when available. For live status after runtime MCP changes, use `controller.mcpServerStatus()` while the query is live and SDK streaming input/output is active |
| `onElicitation`                   | First-class Agent SDK `OnElicitation` callback for MCP elicitation requests (form fields, URL auth, or other server-requested input)                                                                                                                                                                                                                                    |
| `agent`                           | Select a named Claude Code agent persona for the main thread. Use intentionally: a configured agent can carry its own prompt/tool/model policy, separate from the AI SDK call's prompt/model surface                                                                                                                                                                    |
| `onQueryControllerCreated`        | Callback receiving a `ClaudeCodeQueryController` for safe live-query controls. Control-protocol methods require a live SDK `Query`, and most require SDK streaming input/output; `controller.rawQuery` remains available when you need the raw SDK `Query`                                                                                                              |

**System prompt** (`systemPrompt`) accepts a string, a string array, or the Claude Code preset object (v3.5.0+ for the array form). In the array form, include the re-exported `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` marker as a standalone element to split the static (cross-session cacheable) prefix from the dynamic suffix. The preset object additionally accepts `excludeDynamicSections: true` to strip per-user dynamic sections (working directory, git status) so the prompt caches across users.

**Agent definitions** (`agents`) use the Agent SDK's `AgentDefinition` type directly (v3.5.0+), which adds `effort`, `permissionMode`, `background`, `memory`, `initialPrompt`, `skills`, `maxTurns`, and full model ID strings on top of the previously supported fields:

- `disallowedTools` - Tools to explicitly disallow for the agent
- `mcpServers` - MCP servers available to the agent
- `criticalSystemReminder_EXPERIMENTAL` - Experimental critical reminder

**Alpha options** (v3.5.0+, marked `@alpha` upstream and subject to change): `taskBudget` (`{ total: number }` API-side token budget), `sessionStore` (mirror session transcripts to a custom storage adapter; the provider rejects combining it with `persistSession: false` or `enableFileCheckpointing: true`, and `continue: true` without a `resume` ID requires the store to implement `listSessions()`), `sessionStoreFlush` (`'batched'` or `'eager'`), and `loadTimeoutMs` (resume-load timeout). The SDK's `InMemorySessionStore` reference implementation and the `SessionStore`/`SessionStoreFlush` types are re-exported.

The package also re-exports SDK helper functions/types used by advanced hosts: `resolveSettings`, `filterEscalatingDefaultMode`, `SandboxCredentialsConfig`, and `SDKFilesPersistedEvent` in addition to the session, hook, MCP, permission, and warm-start exports documented below.

### User dialogs (`onUserDialog` / `supportedDialogKinds`)

Some CLI flows ask the host to render a blocking dialog (a `request_user_dialog` control request) — for example `'refusal_fallback_prompt'`, which asks whether to retry a refused request differently. The SDK **fails closed** here: a dialog kind not declared in `supportedDialogKinds` is never emitted, and the flow behind it degrades to its no-dialog behavior (for `'refusal_fallback_prompt'`, the classic refusal error ends the turn). Providing `onUserDialog` alone does NOT opt you in — both options are required, and passing a non-empty `supportedDialogKinds` without the callback throws at SDK option intake, so the provider **rejects** that combination at validation time (`createClaudeCode`/model construction throws `Invalid settings`).

```ts
const model = claudeCode('sonnet', {
  supportedDialogKinds: ['refusal_fallback_prompt'],
  onUserDialog: async (request) => {
    // Each dialogKind defines its own payload/result shape; answer
    // unrecognized kinds with { behavior: 'cancelled' } so the CLI
    // applies the dialog's default behavior.
    if (request.dialogKind === 'refusal_fallback_prompt') {
      // Valid results for this kind: 'retry_fallback' | 'edit_prompt' | 'cancelled'
      return { behavior: 'completed', result: 'retry_fallback' };
    }
    return { behavior: 'cancelled' };
  },
});
```

The `OnUserDialog`, `UserDialogRequest`, and `UserDialogResult` types are re-exported. Note that `UserDialogResult.result` is typed `unknown` — the CLI validates it against the dialog kind's own result schema at runtime, and a result that doesn't match (e.g. the wrong shape or an unknown string) is **silently** replaced by the dialog's default (for `'refusal_fallback_prompt'`, `'cancelled'`), so double-check the result values for each kind you handle.

### Permission decisions (`canUseTool`, `permissionMode`, and AI SDK `toolApproval`)

SDK 0.3.x enriched the Claude Agent SDK `canUseTool` callback (no provider change needed — these arrive on the existing `options` argument):

AI SDK v7 `toolApproval` is **not** bridged to Claude Code's internal tool permission system. Use Claude Agent SDK `canUseTool` / `permissionMode` for Claude Code built-in and MCP tools; call-level `toolApproval` on `generateText`/`streamText` applies to app-level AI SDK tools handled by the `ai` package.

- `title` — full permission prompt sentence (e.g. "Claude wants to read foo.txt"); prefer it over reconstructing from `toolName` + input
- `displayName` — short noun phrase for the tool action (e.g. "Read file"), suitable for button labels
- `description` — human-readable subtitle (e.g. "Claude will have read and write access to ...")

`PermissionResult` (both `allow` and `deny` branches) gained an optional `decisionClassification` — `'user_temporary' | 'user_permanent' | 'user_reject'` — describing how the decision was made; the `PermissionDecisionClassification` type is re-exported.

```ts
const model = claudeCode('sonnet', {
  canUseTool: async (toolName, input, options) => {
    // Prefer the SDK-provided prompt text over reconstructing it yourself.
    const approved = await askUser({
      prompt: options.title ?? `Allow ${toolName}?`, // "Claude wants to read foo.txt"
      buttonLabel: options.displayName ?? toolName, // "Read file"
      subtitle: options.description, // "Claude will have read access to ..."
    });
    return approved
      ? { behavior: 'allow', updatedInput: input, decisionClassification: 'user_temporary' }
      : { behavior: 'deny', message: 'Denied by user', decisionClassification: 'user_reject' };
  },
});
```

> **Upstream CLI caveats (verified on CLI 2.1.172):**
>
> - A `PreToolUse` hook returning `permissionDecision: 'defer'` combined with a `canUseTool` callback fails the tool call **before** `canUseTool` is ever consulted. When `canUseTool` should handle the call, have the hook return no decision (or `'allow'`) instead of `'defer'`.
> - The `PermissionDenied` hook only fires for CLI-internal auto-mode classifier denials (e.g. `permissionMode: 'auto'`). Denials issued by `canUseTool` do **not** trigger it — they surface via the result message's `permission_denials`, which the provider merges into `finalStep.providerMetadata['claude-code'].permissionDenials`.

### Agent SDK event callbacks (`onSdkMessage`, task/hook/MCP status, elicitation)

Use these callbacks when you need Agent SDK observability without parsing AI SDK stream parts yourself:

```ts
const model = claudeCode('sonnet', {
  onSdkMessage: (message) => {
    console.debug('raw SDK message:', message.type);
  },
  onTaskEvent: (event) => {
    console.debug('task event:', event.subtype);
  },
  includeHookEvents: true,
  onHookEvent: (event) => {
    console.debug('hook event:', event.subtype);
  },
  onMcpStatusChange: (status) => {
    console.debug('MCP init status snapshot:', status);
  },
  onElicitation: async (request) => {
    return renderMcpElicitation(request);
  },
});
```

- `onSdkMessage` receives the raw `SDKMessage` objects the provider observes. Prefer this when you want to preserve new or rare SDK messages without waiting for provider-specific metadata.
- `onTaskEvent` receives normalized task/subagent events and the same objects are collected into `providerMetadata['claude-code'].taskEvents` when any fire during the request.
- `onHookEvent` receives normalized hook lifecycle events; because the underlying SDK only emits hook lifecycle messages when requested, pair it with `includeHookEvents: true`.
- `onMcpStatusChange` receives the initial MCP server status snapshot observed during the request; final metadata includes that same request-time `mcpServers` snapshot when available. For live status after `reconnectMcpServer()`, `toggleMcpServer()`, or `setMcpServers()`, call `controller.mcpServerStatus()` while the query is live and SDK streaming input/output is active.
- `onElicitation` is the first-class Agent SDK `OnElicitation` hook. It is for MCP-server-requested input; if you do not provide it, unhandled elicitation requests follow the SDK's default decline/cancel behavior.
- `agent` selects a named Claude Code agent for the main thread. This is different from `agents` (which defines subagents). Use it only when you want the named agent's configured prompt/tools/model behavior to participate in the main request.

See [`ClaudeCodeSettings`](https://github.com/ben-vargas/ai-sdk-provider-claude-code/blob/main/src/types.ts) for the full list of supported options (e.g., `allowedTools`, `disallowedTools`, `hooks`, `canUseTool`, `env`, `settingSources`).

For options not explicitly exposed, use the `sdkOptions` escape hatch. It **overrides** explicit settings,
but provider-managed fields are ignored (`model`, `abortController`, `prompt`, `outputFormat`).
If you set `sdkOptions.resume`, it also drives the streaming prompt `session_id` so the SDK
and prompt target the same session.

```ts
const model = claudeCode('sonnet', {
  betas: ['context-1m-2025-08-07'],
  sandbox: { enabled: true },
  persistSession: false, // Don't persist session to disk
  sdkOptions: {
    maxBudgetUsd: 1,
    resume: 'session-abc',
  },
});
```

### SDK boundaries

**Provider-managed fields** are set internally and ignored if passed via `sdkOptions`: `model`, `abortController`, `prompt`, and `outputFormat`.

`agent` and `onElicitation` are first-class `ClaudeCodeSettings` fields on the 4.x line. Older 3.x docs described them as `sdkOptions` escape hatches; use the direct settings names in new code.

**Alternate SDK entry points** — the Agent SDK also ships `/browser` (WebSocket browser transport), `/bridge` (remote-control session transport), and `/assistant` (worker/daemon harness) entry points. These are alpha surfaces with their own versioning cadence and are aimed at embedding hosts rather than AI SDK consumers, so this provider does not re-export them. Import them directly from `@anthropic-ai/claude-agent-sdk/<entry>` if you need them, with the usual alpha-stability caveats.

## Claude Agent SDK 0.3.x Notes

This provider depends on `@anthropic-ai/claude-agent-sdk@0.3.251` (exact pin). The pin is exact rather than a caret because upstream releases have shipped broken `sdk.d.ts` declarations before (0.3.198–0.3.202 collapsed `SDKMessage` to `any`, fixed in 0.3.203); the weekly canary gates each pin move. The 0.3.x line introduces a few changes worth knowing about:

### New peer dependencies

The Agent SDK now declares two additional peer dependencies alongside `zod`:

- `@anthropic-ai/sdk` (`>=0.93.0`)
- `@modelcontextprotocol/sdk` (`^1.29.0`)

npm 7+ installs these automatically; if your package manager does not auto-install peers (or you pin versions), add them to your project explicitly.

### Per-platform native binaries

The Agent SDK now distributes the Claude Code runtime as per-platform native binaries via `optionalDependencies` (e.g., `@anthropic-ai/claude-agent-sdk-darwin-arm64`, `-linux-x64`, `-win32-x64`) instead of a single bundled `cli.js`. The right binary for your platform is selected at install time. If you use `pathToClaudeCodeExecutable`, `executable`, or `executableArgs`, re-validate them against your deployment — they primarily apply when pointing at a custom CLI rather than the bundled native binary. Docker/CI images that prune `optionalDependencies` will need to keep them enabled.

### Settings isolation (`settingSources`)

SDK 0.3.x changed the SDK-level default: omitting `settingSources` now loads ALL filesystem settings (user, project, and local — matching CLI behavior). This provider preserves its documented isolation default by explicitly passing `settingSources: []` when you don't set it. Opt in to filesystem settings via `settingSources: ['user', 'project', 'local']` (or override through `sdkOptions.settingSources`).

### Subprocess environment allowlist

SDK 0.3.x treats `Options.env` as a full **replacement** for the subprocess environment (it is no longer merged with `process.env`). The provider always constructs the subprocess environment from a sanitizing allowlist of `process.env`, then applies your `env` setting and `sdkOptions.env` on top (your values win; set a key to `undefined` to remove it). The allowlist is:

- **Platform basics** — POSIX: `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`, `USER`, `LANG`, `LC_ALL`, `TMPDIR`; Windows: `APPDATA`, `COMSPEC`, `HOMEDRIVE`, `HOMEPATH`, `LOCALAPPDATA`, `PATH`, `PATHEXT`, `SYSTEMDRIVE`, `SYSTEMROOT`, `TEMP`, `TMP`, `USERNAME`, `USERPROFILE`, `WINDIR`
- **Prefix-matched** — any variable starting with `ANTHROPIC_`, `CLAUDE_`, `AWS_`, or `GOOGLE_` (covers `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CONFIG_DIR`, Bedrock and Vertex credentials, etc.)
- **Proxy/TLS** — `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` (upper- and lowercase), `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `SSL_CERT_DIR`
- **Cloud extras** — `GCLOUD_PROJECT`, `CLOUD_ML_REGION`

Variables outside this list are not inherited by the subprocess; pass them explicitly via the `env` setting if needed. The provider also sets `CLAUDE_AGENT_SDK_CLIENT_APP` to `ai-sdk-provider-claude-code/<version>` (used in the SDK's User-Agent) unless you already set it via the process environment, the `env` setting, or `sdkOptions.env`.

## Mid-Session Message Injection

This provider supports **mid-session message injection** for supervisor patterns, allowing you to interrupt, redirect, or provide feedback to an agent during execution.

```typescript
import { streamText } from 'ai';
import { claudeCode, type MessageInjector } from 'ai-sdk-provider-claude-code';

let injector: MessageInjector | null = null;

const result = streamText({
  model: claudeCode('haiku', {
    streamingInput: 'always', // Required for injection
    onStreamStart: (inj) => {
      injector = inj;

      // Example: Inject after 5 seconds
      setTimeout(() => {
        injector?.inject('STOP! Change of plans - do something else.');
      }, 5000);
    },
  }),
  prompt: 'Write 10 files with poems...',
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

**Requirements:**

- `streamingInput: 'always'` or `'auto'` with `canUseTool` set; image parts also auto-enable SDK streaming input under `'auto'`
- Messages injected via `inject(content)` are delivered to the agent mid-turn

**Important:** Injection works between tool calls, not during continuous text generation. Use tasks that involve tool usage (file operations, bash commands, etc.) for effective mid-turn interruption.

**Use Cases:**

- Stop an agent mid-task
- Redirect to a different goal
- Provide real-time feedback
- Implement human-in-the-loop approval workflows

**API:**

- `inject(content: string, onResult?: (delivered: boolean) => void)` - Inject a user message. Optional callback reports delivery status.
- `close()` - Signal no more messages will be injected

**Delivery Tracking:**

```typescript
injector.inject('STOP!', (delivered) => {
  if (!delivered) {
    // Session ended before message was delivered
    // Handle retry via session resume, etc.
  }
});
```

See [examples/message-injection.ts](examples/message-injection.ts) for complete examples including conditional injection and supervisor approval patterns.

## Image Inputs

- With `streamingInput: 'auto'` (the default), supported image prompts automatically enable the Agent SDK streaming-input path for that request; you no longer need to set `streamingInput: 'always'` just to send images.
- Supported payloads include data URLs (`data:image/png;base64,...`), strings prefixed with `base64:<mediaType>,<data>`, or AI SDK v7 file parts such as `{ type: 'file', data: { type: 'data', data: '<base64>' }, mediaType: 'image/png' }` (use `mediaType`, not `mimeType`).
- Remote HTTP(S) image URLs are ignored with the warning "Image URLs are not supported by this provider; supply base64/data URLs." (`supportsImageUrls` remains `false`).
- `streamingInput: 'off'` remains an explicit opt-out: image prompts skip the streaming-input path, image parts are omitted, and the provider emits a generic `type: 'other'` image streaming-input warning.
- Use realistic image payloads—very small placeholders may result in the model asking for a different image.
- `examples/images.ts` accepts a local image path, reads its bytes, and builds an AI SDK v7 file part: `npx tsx examples/images.ts /absolute/path/to/image.png`.

## Skills Support

Claude Code supports **Skills** - custom tools and capabilities defined in your user or project settings. The simplest way to enable them (v3.5.0+) is the `skills` option, which removes the need to add `'Skill'` to `allowedTools` yourself:

```typescript
import { claudeCode } from 'ai-sdk-provider-claude-code';
import { streamText } from 'ai';

const result = await streamText({
  model: claudeCode('sonnet', {
    settingSources: ['user', 'project'], // still required for filesystem skill discovery
    skills: 'all', // or ['pdf', 'docx'] to enable only specific skills
  }),
  prompt: 'Use my /custom-skill to help with this task',
});
```

Note that `skills` is a context filter, not a sandbox: unlisted skills are hidden from the model but their files remain readable on disk.

Alternatively, configure both `settingSources` and `allowedTools` explicitly:

```typescript
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
- `allowedTools` must include `'Skill'` to invoke skills (not needed when using the `skills` option)

**Where to define Skills:**

- User: `~/.claude/skills/your-skill/SKILL.md`
- Project: `.claude/skills/your-skill/SKILL.md`

**Validation:** If you add `'Skill'` to `allowedTools` but forget to set `settingSources`, a validation warning will alert you that skills won't load.

See [examples/skills-management.ts](examples/skills-management.ts) for more examples.

## Using AI SDK Tools

The Claude Code CLI executes its own tools, so AI SDK tools passed to `generateText`/`streamText` via the `tools` option are ignored (with an `unsupported` warning). Automatic bridging is impossible by design: at the `LanguageModelV4` layer the provider only receives tool _declarations_ (name, description, JSON schema) — the `execute` functions live in the `ai` package layer and never reach any provider.

Instead, bridge your tools explicitly with the `createAiSdkMcpServer` helper, which turns a map of AI SDK tools into an in-process MCP server that the CLI can call:

```typescript
import { generateText, tool } from 'ai';
import { z } from 'zod';
import { claudeCode, createAiSdkMcpServer } from 'ai-sdk-provider-claude-code';

const tools = {
  add: tool({
    description: 'Add two numbers',
    inputSchema: z.object({ a: z.number(), b: z.number() }),
    execute: async ({ a, b }) => ({ sum: a + b }),
  }),
};

const { text } = await generateText({
  model: claudeCode('sonnet', {
    mcpServers: { myTools: createAiSdkMcpServer('myTools', tools) },
    // Tools are exposed to the CLI as mcp__<serverName>__<toolName>
    allowedTools: ['mcp__myTools__add'],
  }),
  prompt: 'What is 2 + 3? Use the add tool.',
});
```

Notes:

- Each tool's `execute` runs in your process; string results pass through as MCP text content, everything else is `JSON.stringify`'d, and thrown errors become `isError` tool results instead of crashing the CLI session. Results that cannot be serialized to JSON (e.g. circular objects) also become `isError` results with a serialization message.
- Tool calls/results surface to the AI SDK as **provider-executed dynamic tool parts** (`tool-call`/`tool-result` with `mcp__<serverName>__<toolName>` names), not as executions of your local `tools` option.
- AI SDK v7 `toolApproval` is call-level approval for app-level AI SDK tools. Once a tool is exposed to Claude Code as MCP, approve or deny it with Claude Agent SDK controls (`canUseTool`, `permissionMode`, `allowedTools`, `disallowedTools`).
- Only **Zod object schemas** are supported (`z.object({...})`, the same schema you pass to the AI SDK `tool()` helper). Tools defined with the AI SDK's `jsonSchema()` helper are rejected at creation time because the Agent SDK's `tool()` requires a Zod shape.
- **Validation scope:** the Agent SDK's `tool()` takes only the schema _shape_ and validates incoming args field-by-field (running field-level validation and transforms, and stripping unknown keys) before `execute` runs. Object-level constructs — `.refine()`/`.superRefine()` (cross-field invariants) and `.strict()`/`.passthrough()`/`.catchall()` (unknown-key modes) — are **not** enforced by the bridge: re-parsing on top of the SDK's output would re-run transforms and reject valid transform schemas (e.g. `z.string().transform(v => v.length)`). Perform cross-field and unknown-key checks inside `execute`.
- Tools without an `execute` function (client-executed tools) are rejected at creation time.
- The minimal options object passed to `execute` contains `toolCallId` and `abortSignal` when available; the AI SDK's full `ToolCallOptions` (e.g. `messages`) is not available since the tool runs outside the AI SDK call loop. Note that `toolCallId` here is the MCP JSON-RPC request id (often a small integer like `'42'`), not the model's `toolu_...` tool_use id, so it will not match the `toolCallId` on the AI SDK's `tool-call`/`tool-result` stream parts.

See [examples/ai-sdk-tools.ts](examples/ai-sdk-tools.ts) for a runnable example (`npm run example:ai-sdk-tools`).

## Session Management

Every request runs as a Claude Code session, persisted under `~/.claude/projects/` by default. In AI SDK v7, read the session ID from `finalStep.providerMetadata['claude-code'].sessionId` (`result.finalStep` for `generateText`, or `await stream.finalStep` for `streamText`). Sessions can be resumed (`resume`), forked (`forkSession`), pinned to a deterministic ID (`sessionId`), titled (`title`), or kept ephemeral (`persistSession: false`). The provider also re-exports the SDK's session lifecycle helpers — `listSessions()`, `getSessionMessages()`, `forkSession()`, `getSessionInfo()`, `renameSession()`, `tagSession()`, `deleteSession()`, `listSubagents()`, `getSubagentMessages()`, `importSessionToStore()`, and `foldSessionSummary()` — for managing stored sessions outside of a query.

See [docs/sessions.md](docs/sessions.md) for the full guide (settings vs helpers, disk storage vs custom `SessionStore`, `title` vs `renameSession()`), and [examples/session-management.ts](examples/session-management.ts) for a runnable walkthrough (`npm run example:sessions`).

## Reducing time-to-first-token (warm start)

The Agent SDK's `startup()` (re-exported by this package) pre-spawns the CLI subprocess and completes its initialize handshake ahead of time, returning a `WarmQuery` handle. Calling `warmQuery.query(prompt)` then writes the prompt directly to the already-running process, eliminating subprocess startup latency from time-to-first-token.

**Limitation — this does not compose with `generateText`/`streamText`.** A `WarmQuery` is a standalone query path: its `query()` method returns the SDK's `Query` directly (usable once per handle), and the SDK exposes no option for handing a pre-warmed process to a regular `query()` call — which is what this provider invokes internally. The provider therefore cannot consume a warm handle, and `startup()` only helps when you are willing to drive the SDK `Query` yourself for that one latency-critical request:

```ts
import { startup, type WarmQuery } from 'ai-sdk-provider-claude-code';

// Pre-warm during idle time (e.g. at server boot, or while the user types).
// You can pass the same Options shape the SDK's query() accepts.
const warm: WarmQuery = await startup({ options: { model: 'sonnet' } });

// Later — the prompt goes straight to the ready process (one query per handle):
for await (const message of warm.query('Summarize the latest deploy log.')) {
  if (message.type === 'assistant') {
    // handle SDK messages directly (this is the SDK stream, not an AI SDK stream)
  }
}

// Or discard an unused warm handle:
// warm.close();           // explicit
// await using warm = ...  // WarmQuery is AsyncDisposable
```

All requests made through this provider report timing in `finalStep.providerMetadata['claude-code']` (`ttftMs`, `ttftStreamMs`, `timeToRequestMs`), plus `warmSpareClaimed` when the SDK reports whether the query was served from a pre-warmed spare process (surfaced as `true` or `false` whenever reported; use `await stream.finalStep` after `streamText`) — use these to measure whether warm-start plumbing is worth it for your workload.

## Limitations

- Requires Node.js ≥ 22
- With `streamingInput: 'auto'`, image inputs auto-enable streaming input for supported base64/data/file-part payloads, but remote image URLs are still not fetched by this provider
- `ProviderV4.files()` / FilesV4 upload is not implemented: inline file/image data is supported where Claude Code can represent it, but the provider does not create durable AI SDK provider-reference uploads
- `ProviderV4.skills()` / SkillsV4 upload is not implemented: Claude Code skills still come from configured user/project/local skill directories via the `skills` / `settingSources` options
- Workflow serialization remains deferred; callback/function settings such as `canUseTool`, hooks, `onSdkMessage`, `onElicitation`, `logger`, `spawnClaudeCodeProcess`, and `SessionStore` methods must be reconstructed by the application
- Some AI SDK parameters are unsupported and ignored with an `unsupported` warning: `temperature`, `topP`, `topK`, `presencePenalty`, `frequencyPenalty`, `stopSequences`, `seed`, and `maxOutputTokens` (the CLI does not accept an output token cap)
- AI SDK `tools`, `toolChoice` (other than `'auto'`), and call-level `toolApproval` do not approve Claude Code internal built-in/MCP tools. To expose custom tools to the CLI, bridge them with the `createAiSdkMcpServer` helper and pass the result via the `mcpServers` setting (plus `allowedTools`); approve or deny Claude Code tools with `canUseTool`, `permissionMode`, `allowedTools`, and `disallowedTools`
- When replaying conversation history through the prompt, assistant tool calls are serialized as text lines — `[Tool call: Read({"file_path":"/x"})]` (inputs truncated at 1000 characters) — paired with `Tool Result (Read): ...` lines for tool messages
- `canUseTool` requires streaming input at the SDK level (AsyncIterable prompt), and image prompts use the same path. This provider supports it via `streamingInput`: use `'auto'` (streams when `canUseTool` is set or image parts are present), `'always'`, or `'off'` (`'off'` disables streaming image input, emits a generic `type: 'other'` image streaming-input warning, and omits image parts). See GUIDE for details.

## Error Diagnostics

Mapped errors from this provider append a trimmed stderr tail to the error message as `... | stderr (tail): <last lines>`, making CLI failures visible in logs without inspecting metadata.

```ts
import { generateText } from 'ai';
import { claudeCode, getErrorMetadata } from 'ai-sdk-provider-claude-code';

try {
  await generateText({ model: claudeCode('sonnet'), prompt: 'Hello!' });
} catch (error) {
  console.error(getErrorMetadata(error)?.stderr);
}
```

The metadata accessor returns the full captured stderr, capped at 4000 characters. Authentication and timeout failures are also classified when the only evidence is in stderr, using high-precision matching to avoid false positives from unrelated stderr output.

## Tool Error Parity (Streaming)

- AI SDK v7 represents failed tool executions with the standard `tool-result` stream event/part and `isError: true`.
- The former provider-specific `tool-error` stream extension is not emitted on the 4.x line; inspect `providerMetadata['claude-code']` (e.g., `rawError`) on the `tool-result` when you need Claude Code details.
- See **Content Block Streaming** below for the current streaming event overview; the Tool Streaming Support doc is historical v5-era reference material.

## Content Block Streaming

This provider handles Anthropic `content_block_*` stream events directly for more responsive UIs:

- **Tool input streaming** — `tool-input-delta` streams arguments incrementally; `tool-call` emits when the tool input block completes (before results), enabling “running” state in UIs.
- **Text streaming** — `text-start/delta/end` emitted from content blocks with proper lifecycle management.
- **Extended thinking** — `reasoning-start/delta/end` emitted from `thinking` content blocks in streaming mode; `reasoning` content parts returned from `doGenerate` in non-streaming mode (availability depends on model and request).

For subagent parent/child tracking, see **Subagent Hierarchy Tracking** in this README.

## Subagent Hierarchy Tracking

When Claude Code spawns subagents via the `Task` tool, this provider exposes parent-child relationships through `providerMetadata`:

```ts
// Available on tool-input-start, tool-call, and tool-result events
providerMetadata['claude-code'].parentToolCallId: string | null;
```

- Task tools: Always null (top-level)
- Child tools: Reference their parent Task's ID
- Parallel Tasks: Child returns null if parent is ambiguous

This enables UIs to build hierarchical views of nested agent execution.

## Provider Metadata

Each response exposes Claude Code metadata under the final step's `providerMetadata['claude-code']` (AI SDK v7: `result.finalStep.providerMetadata`, or `await stream.finalStep` for `streamText`; internally this comes from the provider `doGenerate` result or `finish` stream event):

| Field                     | Type      | Description                                                                                                                                                                                                                                                                                                     |
| ------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessionId`               | `string`  | Session ID for multi-turn conversations                                                                                                                                                                                                                                                                         |
| `costUsd`                 | `number`  | Cost of the request in USD                                                                                                                                                                                                                                                                                      |
| `durationMs`              | `number`  | Total request duration in milliseconds                                                                                                                                                                                                                                                                          |
| `modelUsage`              | `object`  | Per-model token usage breakdown                                                                                                                                                                                                                                                                                 |
| `ttftMs`                  | `number`  | Time to first token in milliseconds (when reported by the SDK)                                                                                                                                                                                                                                                  |
| `ttftStreamMs`            | `number`  | Time to first streamed token in milliseconds (when reported)                                                                                                                                                                                                                                                    |
| `timeToRequestMs`         | `number`  | Time until the API request was issued in milliseconds (when reported)                                                                                                                                                                                                                                           |
| `warmSpareClaimed`        | `boolean` | Whether the query was served from a pre-warmed spare CLI process (when reported); see **Reducing time-to-first-token (warm start)**                                                                                                                                                                             |
| `terminalReason`          | `string`  | Why the turn loop terminated (SDK `TerminalReason`, e.g. `'completed'`, `'max_turns'`; re-exported type)                                                                                                                                                                                                        |
| `apiRetries`              | `number`  | Number of API retry attempts observed during the request (only present when > 0)                                                                                                                                                                                                                                |
| `permissionDenials`       | `array`   | Denied tool calls: `{ toolName, toolUseId?, reason?, agentId?, decisionReasonType?, raw? }` when available. Stream-time auto-denials are warn-logged; PreToolUse-hook denials are merged from the result message                                                                                                |
| `taskEvents`              | `array`   | `ClaudeCodeTaskEvent[]` task/subagent lifecycle events observed during the request (only present when non-empty)                                                                                                                                                                                                |
| `hookEvents`              | `array`   | `ClaudeCodeHookEvent[]` hook lifecycle events observed during the request (only present when non-empty; requires SDK hook event emission, e.g. `includeHookEvents: true`)                                                                                                                                       |
| `mcpServers`              | `array`   | Initial MCP server status snapshot observed from the SDK init message during the request, matching the data delivered to `onMcpStatusChange` when available. Use `controller.mcpServerStatus()` for live status after runtime MCP changes only while the query is live and SDK streaming input/output is active |
| `mirrorErrors`            | `array`   | SessionStore transcript-mirror append failures: `{ error, sessionId }` (only present when non-empty). Each is a transcript batch the SDK DROPPED after retries — also warn-logged — so `sessionStore` consumers can detect a silently-incomplete mirror                                                         |
| `estimatedThinkingTokens` | `number`  | Accumulated live thinking-token estimate from the redacted-thinking phase (only present when > 0); approximate, not the authoritative billed output tokens                                                                                                                                                      |
| `truncated`               | `true`    | Present when the response was recovered from a truncated SDK stream                                                                                                                                                                                                                                             |
| `thinkingTraces`          | `array`   | Thinking blocks extracted in non-streaming mode (`doGenerate` only)                                                                                                                                                                                                                                             |

```ts
const { finalStep } = await generateText({ model, prompt: 'Hello' });
const meta = finalStep.providerMetadata?.['claude-code'];
console.log(meta?.costUsd, meta?.ttftMs, meta?.terminalReason);
```

### Prompt suggestions (`onPromptSuggestion`)

Set `promptSuggestions: true` to receive predicted next prompts. When the option is unset or `false`, the CLI does not emit `prompt_suggestion` messages and `onPromptSuggestion` never fires. Delivery is still subject to CLI heuristics (suppressed on the first turn, after API errors, in plan mode, or via `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false`), so it may not fire on every enabled turn. The SDK delivers the suggestion AFTER the `result` message — i.e. after the AI SDK response has already finished — so it cannot be part of `providerMetadata`. Register a callback instead. (In streaming mode the provider briefly drains post-result messages to deliver the suggestion; the drain stops after the first suggestion and is capped at 10 seconds so a lingering CLI process is never held open indefinitely.)

```ts
const model = claudeCode('sonnet', {
  promptSuggestions: true,
  onPromptSuggestion: (suggestion) => {
    console.log('Suggested next prompt:', suggestion);
  },
});
```

### Query controller (`onQueryControllerCreated` / `createClaudeCodeQueryController`)

`onQueryCreated` still exposes the raw Agent SDK `Query` for advanced consumers. The provider also offers a safer controller surface for the wrapped live-query operations listed below and exports the same wrapper as `createClaudeCodeQueryController(query)`. The controller's `rawQuery` property remains available when you intentionally need the underlying SDK object.

`onQueryControllerCreated` only applies to the live SDK `Query` created for that request. Controller methods that send Agent SDK control requests require that query to still be running, and most control requests are supported by the SDK only when streaming input/output is active. In this provider, set `streamingInput: 'always'` for controller-control recipes (or use `'auto'` only when another feature already triggers streaming input, such as `canUseTool` or image parts).

Use `onQueryControllerCreated` when you want to call wrapped controls—`interrupt()`, `setPermissionMode()`, `setMcpPermissionModeOverride()`, `setModel()`, `setMaxThinkingTokens()`, `applyFlagSettings()`, `mcpServerStatus()`, `reconnectMcpServer()`, `toggleMcpServer()`, `setMcpServers()`, `getContextUsage()`, `rewindFiles()`, `stopTask()`, `backgroundTasks()`, and optional `streamInput()`—without passing the entire raw query through your UI layer:

```ts
import type { ClaudeCodeQueryController } from 'ai-sdk-provider-claude-code';

let activeController: ClaudeCodeQueryController | undefined;
let contextUsage: unknown;

const model = claudeCode('sonnet', {
  streamingInput: 'always', // Required for Agent SDK control requests.
  onQueryControllerCreated: (controller) => {
    activeController = controller;
  },
  hooks: {
    Stop: [
      {
        hooks: [
          async () => {
            contextUsage = await activeController?.getContextUsage();
            return { continue: true };
          },
        ],
      },
    ],
  },
});

const result = await generateText({ model, prompt: 'Hello' });
console.log(contextUsage); // tokens used / remaining in the session context window
```

The controller does not extend the SDK query lifetime. Controller calls that talk to the CLI subprocess must happen before `generateText`/`streamText` resolves; after the subprocess exits, the underlying SDK call rejects with `ProcessTransport is not ready for writing`.

If your app surfaces `stopTask()` controls to the user, also set the `perTaskStopAffordance: true` setting (v4.2.0+). It declares that per-task stop controls exist, so `interrupt()` on a live open-input query only aborts the current turn instead of killing running background tasks. It is a capability assertion for the SDK, not a feature toggle: it does not enable streaming input, and when unset the SDK fails closed (interrupt kills background tasks — otherwise a runaway task would be unstoppable from an app with no per-task controls). One-shot (closed-input) requests kill held-back tasks on interrupt regardless, and like all controller semantics it only applies while the query is live — `stopTask()` is not usable after `generateText`/`streamText` resolves.

For MCP, `onMcpStatusChange` and `providerMetadata['claude-code'].mcpServers` record the request's initial SDK init snapshot; after `reconnectMcpServer()`, `toggleMcpServer()`, or `setMcpServers()`, call `controller.mcpServerStatus()` only while the query is live and SDK streaming input/output is active.

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
