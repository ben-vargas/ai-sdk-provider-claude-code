# Session Management

Every `generateText`/`streamText` call through this provider runs as a Claude Code **session**. By default the CLI persists each session as a JSONL transcript under `~/.claude/projects/` (honoring `CLAUDE_CONFIG_DIR`), and the session ID is surfaced in `providerMetadata['claude-code'].sessionId` so you can resume, fork, inspect, retitle, tag, or delete it later.

This guide ties together the session-related **settings** (passed to `claudeCode(modelId, settings)`) and the session **helper functions** (re-exported from the Claude Agent SDK).

For a runnable end-to-end walkthrough, see [examples/session-management.ts](../examples/session-management.ts) (`npm run example:sessions`).

## Session settings

| Setting           | Type      | Description                                                                                                                                                       |
| ----------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessionId`       | `string`  | Use a specific session ID for a **new** session (deterministic tracking/correlation). Must be a UUID.                                                             |
| `resume`          | `string`  | Resume an existing session by ID. The conversation context is restored from the persisted transcript.                                                             |
| `resumeSessionAt` | `string`  | When resuming, restore the session only up to a specific message UUID (later messages are discarded from context).                                                |
| `forkSession`     | `boolean` | When resuming, fork to a **new** session ID instead of continuing under the original ID (combine with `sessionId` to choose the fork's ID).                       |
| `continue`        | `boolean` | Continue the most recent conversation for the working directory, without needing its ID.                                                                          |
| `persistSession`  | `boolean` | When `false`, the session is not written to `~/.claude/projects/` and cannot be resumed or inspected later. Useful for ephemeral workflows. Default `true`.       |
| `title`           | `string`  | Custom title for a **new** session (instead of auto-generating one from the first prompt). When resuming, the resumed session's persisted title takes precedence. |

### Capturing the session ID

```ts
import { generateText } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';

const result = await generateText({
  model: claudeCode('sonnet'),
  prompt: 'Remember this code word: papaya. Reply with OK.',
});

const sessionId = result.providerMetadata?.['claude-code']?.sessionId as string;
```

### Resuming a session

```ts
const followUp = await generateText({
  model: claudeCode('sonnet', { resume: sessionId }),
  prompt: 'What was the code word?',
});
// followUp.text mentions "papaya"; the session keeps the same ID.
```

### Forking at query time (the `forkSession` setting)

```ts
const branched = await generateText({
  model: claudeCode('sonnet', { resume: sessionId, forkSession: true }),
  prompt: 'Explore an alternative approach from here.',
});
// branched runs under a NEW session ID; the original transcript is untouched.
const forkId = branched.providerMetadata?.['claude-code']?.sessionId as string;
```

## Session helper functions

These are re-exported from `@anthropic-ai/claude-agent-sdk` for convenience — no extra dependency needed. They are plain async functions, independent of any provider/model instance.

| Helper                                              | Description                                                                                                                                                                                               |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listSessions(options?)`                            | List metadata for all persisted sessions (`SDKSessionInfo[]`) — the discovery API for building session pickers. Supports filtering options (e.g. by project directory via `dir`, plus `limit`).           |
| `getSessionMessages(sessionId, options?)`           | Read the main conversation transcript of a session (`SessionMessage[]`) — the counterpart to `getSubagentMessages()` for the top-level thread.                                                            |
| `getSessionInfo(sessionId, options?)`               | Read metadata for one session (`SDKSessionInfo`: `summary`, `customTitle`, `firstPrompt`, `lastModified`, `cwd`, `gitBranch`, `tag`, ...). Returns `undefined` if not found.                              |
| `forkSession(sessionId, options?)`                  | Copy a session's transcript into a new session ID **without running a query** (optionally sliced via `upToMessageId`, retitled via `title`). Returns `{ sessionId }`, resumable via the `resume` setting. |
| `renameSession(sessionId, title, options?)`         | Retitle an existing session.                                                                                                                                                                              |
| `tagSession(sessionId, tag, options?)`              | Set (or clear, with `null`) a session's tag.                                                                                                                                                              |
| `deleteSession(sessionId, options?)`                | Delete a session's persisted transcript.                                                                                                                                                                  |
| `listSubagents(sessionId, options?)`                | List agent IDs of subagent transcripts recorded under a session.                                                                                                                                          |
| `getSubagentMessages(sessionId, agentId, options?)` | Read a subagent's transcript messages (`SessionMessage[]`).                                                                                                                                               |
| `importSessionToStore(sessionId, store, options?)`  | Copy a local JSONL session (and, by default, its subagent transcripts) into a custom `SessionStore` (alpha).                                                                                              |
| `foldSessionSummary(prev, key, entries, options?)`  | Pure utility for `SessionStore` implementers: fold appended entries into a `SessionSummaryEntry` inside `append()` (alpha).                                                                               |

```ts
import {
  forkSession,
  getSessionInfo,
  renameSession,
  deleteSession,
} from 'ai-sdk-provider-claude-code';

const info = await getSessionInfo(sessionId);
console.log(info?.summary, info?.lastModified);

const fork = await forkSession(sessionId, { title: 'experiment branch' });
// ...resume the fork via claudeCode('sonnet', { resume: fork.sessionId })...

await renameSession(sessionId, 'main investigation');
await deleteSession(fork.sessionId);
```

### Two ways to fork

- **`forkSession` setting** (`{ resume, forkSession: true }`) — fork **and run a query** in one step; the new ID arrives in `providerMetadata`.
- **`forkSession()` helper** — fork the stored transcript **without** running a query (and optionally slice it with `upToMessageId`); resume it later with the `resume` setting.

## Disk storage vs custom `SessionStore`

By default, everything above operates on the local JSONL files under `~/.claude/projects/` (the directory the CLI writes to; `CLAUDE_CONFIG_DIR` relocates it). Helpers that take an `options` object accept `dir` to scope the lookup to one project directory — when omitted, all project directories are searched.

For custom backends (Postgres, S3, Redis, ...), the SDK defines a **`SessionStore`** adapter (alpha — subject to upstream change):

- The `sessionStore` **setting** (with `sessionStoreFlush`, `loadTimeoutMs`) mirrors transcripts to your store **in addition to** local files while queries run. It cannot be combined with `persistSession: false` (local writes are required for the mirror) or `enableFileCheckpointing: true`, and combining it with `continue: true` (without an explicit `resume` ID) requires the store to implement `listSessions()` — the SDK uses it to discover the most recent session. The provider rejects all three invalid combinations at validation time.
- Each helper's `options.sessionStore` redirects that helper to read/write **your store instead of the local filesystem** (e.g. `getSessionInfo(id, { sessionStore: myStore })`).
- `importSessionToStore()` migrates an existing local session into a store; `foldSessionSummary()` and the `SessionKey`/`SessionStoreEntry`/`SessionSummaryEntry` types are the building blocks for writing a store; `InMemorySessionStore` is a reference implementation for tests.

## `title` setting vs `renameSession()`

- The `title` **setting** only names a **new** session at creation time. When resuming, the resumed session's persisted title takes precedence and the setting is ignored.
- To retitle an **existing** session, use the `renameSession()` helper.
- `forkSession()` accepts its own `title` for the fork; if omitted, the fork derives its title from the original (`"<original> (fork)"`).

## Notes

- `sessionId` cannot be combined with `continue` or `resume` unless `forkSession: true` is also set (in which case it names the forked session's ID). The provider enforces this — and the UUID requirement — at validation time, and on multi-turn conversations it stops forwarding `sessionId` once it auto-resumes via the captured session ID (which already carries the custom ID).
- Sessions are stored per working directory (project). If you run queries with different `cwd` settings, pass `dir` to the helpers to disambiguate, or rely on the default search across all project directories.
- `persistSession: false` sessions never reach disk, so none of the helpers can see them.
