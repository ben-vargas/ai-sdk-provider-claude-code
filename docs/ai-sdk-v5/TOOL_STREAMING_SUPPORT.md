# Tool Streaming Support (AI SDK v5)

## Overview
Claude Code now emits full tool streaming events when used through the AI SDK v5 provider. This aligns the provider with the AI SDK's `LanguageModelV2StreamPart` contract, enabling downstream UIs to surface tool calls, inputs, and results in real time.

## Requirements
- **Streaming input enabled**: set `streamingInput: 'always'` or rely on `'auto'` by supplying `canUseTool`.
- **Provider-executed tools**: Claude Code's built-in tools run inside the CLI; for every `tool-call` and `tool-result` event the provider sets `providerExecuted: true` so the AI SDK will not attempt to re-run the tool client-side.
- **Claude Code CLI**: authenticate with `claude login` and ensure the CLI is on your PATH before running streaming examples or tests. Allow the built-in tools explicitly (for example `allowedTools: ['Bash', 'Read']`) or set a permissive permission mode such as `bypassPermissions`.

## Stream Parts Emitted
| Event | Description |
|-------|-------------|
| `tool-input-start` | Sent once per tool use with Claude's tool name and a stable ID. |
| `tool-input-delta` | JSON-serialized arguments. The provider sends cumulative deltas; if Claude resends the full payload, the delta mirrors that payload. |
| `tool-input-end` | Marks completion of the request payload going to the tool. |
| `tool-call` | Includes `toolCallId`, `toolName`, serialized `input`, and `providerExecuted: true`. Raw, non-serialized input is preserved in `providerMetadata['claude-code'].rawInput`. |
| `tool-result` | Streams the CLI output (JSON parsed when possible) with `toolName`, `toolCallId`, `isError`, `providerExecuted: true`, and the original output under `providerMetadata['claude-code'].rawResult`. |

Text streaming (`text-start`/`text-delta`/`text-end`), response metadata, and finish parts continue to behave as before.

## Usage Example
Run the new example to observe the events:
```bash
npm run build
npx tsx examples/tool-streaming.ts
```
The script approves tools via `canUseTool` and logs each event in order, demonstrating directory listing and file-read operations executed by the CLI.

## Testing & Validation
- Vitest suite includes coverage that asserts tool stream parts surface for provider-executed tools (`src/claude-code-language-model.test.ts`).
- Integration and example scripts rely on the compiled `dist` build; run `npm run build && npm run test` before publishing.
- If stream parts stop appearing, re-run with `DEBUG=1` or enable a custom logger (`settings.logger`) to capture warnings from the underlying SDK.

## Known Limitations
- Claude Code does not emit incremental tool argument chunks today; the provider emits a single `tool-input-delta` payload per tool call unless the SDK starts sending partial updates.
- Remote image URLs remain unsupported; convert images to base64 data URLs and set `streamingInput` accordingly.
