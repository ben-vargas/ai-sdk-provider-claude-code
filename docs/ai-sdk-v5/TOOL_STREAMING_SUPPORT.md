# Tool Streaming Support (AI SDK v5)

## Overview

Claude Code now emits full tool streaming events when used through the AI SDK v5 provider. This aligns the provider with the AI SDK's `LanguageModelV2StreamPart` contract, enabling downstream UIs to surface tool calls, inputs, and results in real time.

## Requirements

- **Streaming input enabled**: set `streamingInput: 'always'` or rely on `'auto'` by supplying `canUseTool`.
- **Provider-executed tools**: Claude Code's built-in tools run inside the CLI; for every `tool-call` and `tool-result` event the provider sets `providerExecuted: true` so the AI SDK will not attempt to re-run the tool client-side.
- **Claude Code CLI**: authenticate with `claude login` and ensure the CLI is on your PATH before running streaming examples or tests. Allow the built-in tools explicitly (for example `allowedTools: ['Bash', 'Read']`) or set a permissive permission mode such as `bypassPermissions`.

## Stream Parts Emitted

| Event              | Description                                                                                                                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tool-input-start` | Sent once per tool use with Claude's tool name and a stable ID.                                                                                                                                                                                                                                                           |
| `tool-input-delta` | JSON-serialized argument chunks. The provider emits deltas only for incremental prefix updates (new content appended to previous input). Non-prefix updates (corrections, replacements, or duplicate transmissions) do not emit `tool-input-delta`; the final complete input is always captured in the `tool-call` event. |
| `tool-input-end`   | Marks completion of the request payload going to the tool.                                                                                                                                                                                                                                                                |
| `tool-call`        | Includes `toolCallId`, `toolName`, serialized `input`, and `providerExecuted: true`. Raw, non-serialized input is preserved in `providerMetadata['claude-code'].rawInput`.                                                                                                                                                |
| `tool-error`       | Emitted when tool execution fails, includes `toolCallId`, `toolName`, error message, and is distinct from `tool-result` with `isError: true`.                                                                                                                                                                             |
| `tool-result`      | Streams the CLI output (JSON parsed when possible) with `toolName`, `toolCallId`, `isError`, `providerExecuted: true`, and the original output under `providerMetadata['claude-code'].rawResult`.                                                                                                                         |

Text streaming (`text-start`/`text-delta`/`text-end`), response metadata, and finish parts continue to behave as before.

## Current streaming semantics

This guide describes the v5-era provider. For the current 4.x (AI SDK v7) line, the [README](../../README.md#content-block-streaming) is authoritative. In short:

- Text and reasoning deltas go to the part for their own content block. Blocks are tracked per `parent_tool_use_id`, so root and subagent blocks stay apart. A delta for an untracked block falls back to the global current text part, or to the current open reasoning part in the same scope.
- `tool-input-delta` stops once a tool's input is closed (`tool-input-end`) or its `tool-call` is emitted. Later fragments and assistant snapshots for that tool produce no further deltas.
- For ordinary tools, if `content_block_stop` arrives before the complete assistant tool block, the `tool-call` is emitted at the stop with the streamed input. A complete input that arrives later does not replace it.
- A pending tool call retracted by a superseding (refusal-fallback) message is not re-emitted, even if its block or message is replayed. Retracted `StructuredOutput` attempts are never recovered as the answer.
- The 1 MB tool-input cap counts JavaScript string length (UTF-16 code units), not UTF-8 bytes. It also applies to the running total of streamed fragments.
- `streamStructuredOutput: true` is best-effort; see [Streaming structured output](../../README.md#streaming-structured-output). The default buffered mode emits the CLI-validated object once, when the CLI supplies it.

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
- Delta skipping: If Claude sends non-prefix input updates (e.g., corrections or replacements rather than appends), the provider will skip delta emission and include the final input in the `tool-call` event only.
- Remote image URLs remain unsupported; convert images to base64 data URLs and set `streamingInput` accordingly.

## Performance Considerations

- Delta calculation: Performed only for tool inputs ≤ 10KB and for prefix-only updates. Larger or non-prefix updates skip deltas and are captured in the final `tool-call` payload.
- Size limits: Tool inputs exceeding 1MB throw an error. Inputs above 100KB log a warning due to potential performance impact.
- Memory management: Tool state is retained until stream completion to avoid duplicate `tool-call` emissions when multiple result or error chunks arrive.

Note: This provider extends `tool-error` events to include `providerExecuted: true` and `providerMetadata['claude-code']` for parity with tool-call/result. Downstream consumers can safely ignore these fields if not used.
