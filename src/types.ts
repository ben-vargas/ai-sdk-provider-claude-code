// Import types from the SDK
import type {
  PermissionMode,
  McpServerConfig,
  CanUseTool,
  SdkBeta,
  SandboxSettings,
  SdkPluginConfig,
  Options,
  SpawnedProcess,
  SpawnOptions,
  AgentDefinition,
  Query,
  ThinkingConfig,
  EffortLevel,
  Settings,
  ToolConfig,
  SessionStore,
  SessionStoreFlush,
  OnUserDialog,
} from '@anthropic-ai/claude-agent-sdk';

export type StreamingInputMode = 'auto' | 'always' | 'off';

/**
 * Logger interface for custom logging.
 * Allows consumers to provide their own logging implementation
 * or disable logging entirely.
 *
 * @example
 * ```typescript
 * const customLogger: Logger = {
 *   debug: (message) => myLoggingService.debug(message),
 *   info: (message) => myLoggingService.info(message),
 *   warn: (message) => myLoggingService.warn(message),
 *   error: (message) => myLoggingService.error(message),
 * };
 * ```
 */
export interface Logger {
  /**
   * Log a debug message. Only logged when verbose mode is enabled.
   * Used for detailed execution tracing and troubleshooting.
   */
  debug: (message: string) => void;

  /**
   * Log an informational message. Only logged when verbose mode is enabled.
   * Used for general execution flow information.
   */
  info: (message: string) => void;

  /**
   * Log a warning message.
   */
  warn: (message: string) => void;

  /**
   * Log an error message.
   */
  error: (message: string) => void;
}

/**
 * Configuration settings for Claude Code SDK behavior.
 * These settings control how the CLI executes, what permissions it has,
 * and which tools are available during conversations.
 *
 * @example
 * ```typescript
 * const settings: ClaudeCodeSettings = {
 *   maxTurns: 10,
 *   permissionMode: 'auto',
 *   cwd: '/path/to/project',
 *   allowedTools: ['Read', 'LS'],
 *   disallowedTools: ['Bash(rm:*)']
 * };
 * ```
 */
export interface ClaudeCodeSettings {
  /**
   * Custom path to Claude Code SDK executable
   * @default 'claude' (uses system PATH)
   */
  pathToClaudeCodeExecutable?: string;

  /**
   * Custom system prompt to use
   */
  customSystemPrompt?: string;

  /**
   * Append additional content to the system prompt
   */
  appendSystemPrompt?: string;

  /**
   * Agent SDK system prompt configuration. Preferred over legacy fields.
   * - string: custom system prompt
   * - string[]: custom system prompt blocks; include the
   *   `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` marker (re-exported by this package)
   *   as a standalone element to split the static (cross-session cacheable)
   *   prefix from the dynamic (session-specific) suffix
   * - preset object: Claude Code preset, with optional `append` and
   *   `excludeDynamicSections` (strips per-user dynamic sections such as
   *   working directory and git status so the prompt caches across users)
   */
  systemPrompt?: Options['systemPrompt'];

  /**
   * Maximum number of turns for the conversation
   */
  maxTurns?: number;

  /**
   * Maximum thinking tokens for the model
   *
   * @deprecated Use `thinking` instead.
   */
  maxThinkingTokens?: number;

  /**
   * Controls Claude's thinking/reasoning behavior.
   * Takes precedence over the deprecated `maxThinkingTokens`.
   *
   * - `{ type: 'adaptive' }` — Claude decides when and how much to think (Opus 4.6+, default)
   * - `{ type: 'enabled', budgetTokens?: number }` — Fixed thinking token budget
   * - `{ type: 'disabled' }` — No extended thinking
   *
   * @see https://docs.anthropic.com/en/docs/build-with-claude/adaptive-thinking
   */
  thinking?: ThinkingConfig;

  /**
   * Controls how much effort Claude puts into its response.
   *
   * - `'low'` — Minimal thinking, fastest responses
   * - `'medium'` — Moderate thinking
   * - `'high'` — Deep reasoning (default)
   * - `'xhigh'` — Extra-high effort
   * - `'max'` — Maximum effort (Opus 4.6 only)
   *
   * @see https://docs.anthropic.com/en/docs/build-with-claude/effort
   */
  effort?: EffortLevel;

  /**
   * Enable prompt suggestions. When true, the agent emits a predicted
   * next user prompt after each turn (arrives after the result message).
   */
  promptSuggestions?: boolean;

  /**
   * Working directory for CLI operations
   */
  cwd?: string;

  /**
   * JavaScript runtime to use
   * @default 'node' (or 'bun' if Bun is detected)
   */
  executable?: 'bun' | 'deno' | 'node';

  /**
   * Additional arguments for the JavaScript runtime
   */
  executableArgs?: string[];

  /**
   * Permission mode for tool usage.
   *
   * Note: `'delegate'` was removed in Agent SDK 0.3.x — the CLI rejects
   * `--permission-mode delegate` at argv parsing — so it is no longer
   * accepted here either.
   * @default 'default'
   */
  permissionMode?: PermissionMode;

  /**
   * Custom tool name for permission prompts
   */
  permissionPromptToolName?: string;

  /**
   * Continue the most recent conversation
   */
  continue?: boolean;

  /**
   * Resume a specific session by ID
   */
  resume?: string;

  /**
   * Use a specific session ID for this query.
   * Allows deterministic session identifiers for tracking and correlation.
   *
   * Must be a valid UUID (the CLI rejects other formats). Cannot be combined
   * with `continue` or `resume` unless `forkSession` is also set (it then
   * names the forked session's ID); the provider rejects those combinations
   * at validation time. On multi-turn conversations the provider forwards
   * `sessionId` only on the first turn — subsequent turns resume the captured
   * session (which already carries the custom ID).
   */
  sessionId?: string;

  /**
   * Tools to explicitly allow during execution
   * Examples: ['Read', 'LS', 'Bash(git log:*)']
   */
  allowedTools?: string[];

  /**
   * Tools to disallow during execution
   * Examples: ['Write', 'Edit', 'Bash(rm:*)']
   */
  disallowedTools?: string[];

  /**
   * Enable Agent SDK beta features.
   */
  betas?: SdkBeta[];

  /**
   * Allow bypassing permissions when using permissionMode: 'bypassPermissions'.
   */
  allowDangerouslySkipPermissions?: boolean;

  /**
   * Enable file checkpointing for rewind support.
   */
  enableFileCheckpointing?: boolean;

  /**
   * Maximum budget in USD for the query.
   */
  maxBudgetUsd?: number;

  /**
   * Load custom plugins from local paths.
   */
  plugins?: SdkPluginConfig[];

  /**
   * Resume session at a specific message UUID.
   */
  resumeSessionAt?: string;

  /**
   * Configure sandbox behavior programmatically.
   *
   * Cannot be combined with a `settings` FILE PATH (the SDK throws at query
   * time); pass `settings` as an inline object instead, or move the sandbox
   * configuration into the settings file. The provider rejects the
   * combination at validation time.
   */
  sandbox?: SandboxSettings;

  /**
   * Tool configuration (array of tool names or Claude Code preset).
   */
  tools?: Options['tools'];

  /**
   * Skills to enable for the main session. This is the single place to turn
   * skills on; you do not need to add `'Skill'` to `allowedTools` yourself
   * when using this option.
   *
   * - `'all'`: enable every discovered skill
   * - `string[]`: enable only the listed skills (SKILL.md `name`/directory
   *   name, or `plugin:skill` for plugin-qualified skills)
   * - omitted (default): no SDK auto-configuration
   *
   * Note: filesystem skills are discovered via `settingSources` — set it
   * (e.g. `['user', 'project']`) so skill definitions can be loaded.
   */
  skills?: string[] | 'all';

  /**
   * Inline settings object or path to a settings JSON file.
   * Applied as an additional settings layer for the session.
   *
   * A settings file path cannot be combined with the `sandbox` option (the
   * SDK throws at query time; inline objects are fine). The provider rejects
   * the combination at validation time.
   */
  settings?: string | Settings;

  /**
   * Policy-tier settings supplied by the spawning parent process.
   * Filtered restrictive-only by the SDK; intended for embedding
   * applications that need to enforce lockdown settings on the
   * subprocess without writing root-owned files.
   */
  managedSettings?: Settings;

  /**
   * Map built-in tool names to replacement tools (e.g. MCP tools).
   *
   * @example
   * ```typescript
   * toolAliases: { Bash: 'mcp__workspace__bash' }
   * ```
   */
  toolAliases?: Record<string, string>;

  /**
   * Per-tool configuration for built-in tools
   * (e.g. `{ askUserQuestion: { previewFormat: 'html' } }`).
   */
  toolConfig?: ToolConfig;

  /**
   * Custom workflow instructions for plan mode. When `permissionMode` is
   * `'plan'`, this string replaces the default code-implementation workflow
   * body in the plan-mode system reminder.
   */
  planModeInstructions?: string;

  /**
   * Custom title for a new session. When provided, the session uses this
   * title instead of auto-generating one from the first user message.
   * When resuming, the resumed session's persisted title takes precedence.
   */
  title?: string;

  /**
   * Forward subagent text and thinking blocks as messages with
   * `parent_tool_use_id` set so consumers can render a nested transcript.
   * By default only tool_use/tool_result blocks from subagents are emitted.
   */
  forwardSubagentText?: boolean;

  /**
   * Enable periodic AI-generated progress summaries for running subagents,
   * emitted on `task_progress` events via the `summary` field.
   */
  agentProgressSummaries?: boolean;

  /**
   * Include hook lifecycle events (`hook_started`, `hook_progress`,
   * `hook_response`) in the output stream for all hook event types.
   * @default false
   */
  includeHookEvents?: boolean;

  /**
   * MCP server configuration
   */
  mcpServers?: Record<string, McpServerConfig>;

  /**
   * Filesystem settings sources to load (CLAUDE.md, settings.json, etc.)
   * When omitted, the provider explicitly passes `[]` to the Agent SDK so that
   * no filesystem settings are loaded (isolation mode).
   *
   * Note: Agent SDK 0.3.x changed the SDK-level default — omitting
   * `settingSources` now loads ALL filesystem settings (matching CLI behavior).
   * The provider pins isolation mode unless you set this option (or override
   * `settingSources` via the `sdkOptions` escape hatch).
   *
   * Required for Skills support - skills are loaded from these sources.
   * @example ['user', 'project']
   */
  settingSources?: Array<'user' | 'project' | 'local'>;

  /**
   * Hook callbacks for lifecycle events (e.g., PreToolUse, PostToolUse).
   * Note: typed loosely to support multiple SDK versions.
   *
   * Two verified upstream CLI behaviors to be aware of (CLI 2.1.172):
   * - A `PreToolUse` hook returning `permissionDecision: 'defer'` combined
   *   with a {@link canUseTool} callback fails the tool call before
   *   `canUseTool` is ever consulted. Return no decision (or `'allow'`)
   *   instead of `'defer'` when `canUseTool` should handle the call.
   * - The `PermissionDenied` hook only fires for CLI-internal auto-mode
   *   classifier denials (e.g. `permissionMode: 'auto'`). Denials issued by
   *   `canUseTool` do NOT trigger it; they surface via the result message's
   *   `permission_denials`, exposed as
   *   `providerMetadata['claude-code'].permissionDenials`.
   */
  hooks?: Partial<
    Record<
      string,
      Array<{ matcher?: string; hooks: Array<(...args: unknown[]) => Promise<unknown>> }>
    >
  >;

  /**
   * Dynamic permission callback invoked before a tool is executed.
   * Allows runtime approval/denial and optional input mutation.
   *
   * Upstream CLI caveats (verified on CLI 2.1.172):
   * - Do not combine with a `PreToolUse` hook that returns
   *   `permissionDecision: 'defer'` — the CLI fails the tool call before
   *   this callback is consulted.
   * - Denials returned here do not fire the `PermissionDenied` hook (it only
   *   fires for auto-mode classifier denials); they surface in
   *   `providerMetadata['claude-code'].permissionDenials` instead.
   */
  canUseTool?: CanUseTool;

  /**
   * Callback for handling `request_user_dialog` control requests — blocking
   * dialogs the CLI asks the host to render (e.g. the refusal-fallback
   * prompt). Each `dialogKind` defines its own payload and result shape;
   * answer unrecognized kinds with `{ behavior: 'cancelled' }` so the CLI
   * applies the dialog's default behavior.
   *
   * The SDK fails closed around dialogs: when the CLI requests a dialog and
   * no handler/declared kind exists, the dialog-gated flow degrades to its
   * no-dialog behavior (for `'refusal_fallback_prompt'`, the classic refusal
   * error ends the turn). Wire this callback together with
   * `supportedDialogKinds` to opt in — providing the callback alone does NOT
   * make the CLI emit dialogs.
   */
  onUserDialog?: OnUserDialog;

  /**
   * Dialog kinds (`request_user_dialog` `dialog_kind` values, e.g.
   * `'refusal_fallback_prompt'`) that your `onUserDialog` callback can
   * actually render. The CLI only emits dialog kinds declared here and
   * fails closed on absence: an undeclared kind is never emitted and the
   * flow behind it degrades to its no-dialog behavior instead. Omitting the
   * option entirely means no dialogs are emitted, even with `onUserDialog`
   * wired.
   *
   * Requires `onUserDialog` — the SDK throws at option intake when a
   * non-empty list is passed without the callback (the provider also warns
   * at validation time).
   */
  supportedDialogKinds?: string[];

  /**
   * Controls whether to send streaming input to the SDK (enables canUseTool).
   * - 'auto' (default): stream when canUseTool is provided
   * - 'always': always stream
   * - 'off': never stream (legacy behavior)
   */
  streamingInput?: StreamingInputMode;

  /**
   * Enable verbose logging for debugging
   */
  verbose?: boolean;

  /**
   * Enable programmatic debug logging from the SDK.
   */
  debug?: boolean;

  /**
   * Path to a file for SDK debug log output.
   */
  debugFile?: string;

  /**
   * Custom logger for handling warnings and errors.
   * - Set to `false` to disable all logging
   * - Provide a Logger object to use custom logging
   * - Leave undefined to use console (default)
   *
   * @default console
   * @example
   * ```typescript
   * // Disable logging
   * const settings = { logger: false };
   *
   * // Custom logger
   * const settings = {
   *   logger: {
   *     warn: (msg) => myLogger.warn(msg),
   *     error: (msg) => myLogger.error(msg),
   *   }
   * };
   * ```
   */
  logger?: Logger | false;

  /**
   * Environment variables to set for the Claude Code subprocess.
   *
   * The provider always constructs the subprocess environment from a sanitizing
   * allowlist of `process.env` (HOME, PATH, proxy/TLS vars, `ANTHROPIC_*`,
   * `CLAUDE_*`, `AWS_*`, `GOOGLE_*`, etc.), then merges these values over it
   * (set a key to `undefined` to remove it). Agent SDK 0.3.x treats
   * `Options.env` as a full replacement for the subprocess environment, so
   * variables outside the allowlist are not inherited unless set here.
   */
  env?: Record<string, string | undefined>;

  /**
   * Additional directories Claude can access.
   */
  additionalDirectories?: string[];

  /**
   * Programmatically defined subagents.
   *
   * Uses the Agent SDK's `AgentDefinition` directly, which includes
   * `effort`, `permissionMode`, `background`, `memory`, `initialPrompt`,
   * `skills`, `maxTurns`, and full model ID strings in addition to the
   * core `description`/`prompt`/`tools` fields.
   */
  agents?: Record<string, AgentDefinition>;

  /**
   * Include partial message events from the SDK stream.
   */
  includePartialMessages?: boolean;

  /**
   * Model(s) to use if the primary model is overloaded or unavailable.
   * Accepts a comma-separated list to try each in order; the primary model
   * is re-tried at the start of each user turn.
   *
   * Must differ from the main model (the SDK throws when they are equal);
   * the provider rejects the combination before invoking the SDK.
   */
  fallbackModel?: string;

  /**
   * When resuming, fork to a new session ID instead of continuing the original.
   */
  forkSession?: boolean;

  /**
   * Callback for stderr output from the underlying process.
   */
  stderr?: (data: string) => void;

  /**
   * Enforce strict MCP validation.
   */
  strictMcpConfig?: boolean;

  /**
   * Additional CLI arguments.
   */
  extraArgs?: Record<string, string | null>;

  /**
   * When false, disables session persistence to disk.
   * Sessions will not be saved to ~/.claude/projects/ and cannot be resumed later.
   * Useful for ephemeral or automated workflows where session history is not needed.
   * @default true
   */
  persistSession?: boolean;

  /**
   * API-side task budget in tokens. When set, the model is made aware of
   * its remaining token budget so it can pace tool use and wrap up before
   * the limit.
   *
   * @alpha Subject to change in upstream Agent SDK releases.
   */
  taskBudget?: { total: number };

  /**
   * Mirror session transcripts to a custom storage adapter (e.g. Postgres,
   * S3, Redis) in addition to local JSONL files. Cannot be combined with
   * `persistSession: false` — local writes are required for the mirror to
   * function — or with `enableFileCheckpointing: true` — checkpoint backup
   * blobs are not mirrored, so `rewindFiles()` fails after a store-backed
   * resume. Combining it with `continue: true` (without a `resume` ID)
   * additionally requires the store to implement `listSessions()`, which the
   * SDK uses to discover the most recent session. The provider rejects all
   * three invalid combinations at validation time.
   *
   * @alpha Subject to change in upstream Agent SDK releases.
   */
  sessionStore?: SessionStore;

  /**
   * Flush strategy for `sessionStore` transcript mirroring:
   * `'batched'` (default) or `'eager'`. Ignored when `sessionStore` is unset.
   *
   * @alpha Subject to change in upstream Agent SDK releases.
   */
  sessionStoreFlush?: SessionStoreFlush;

  /**
   * Timeout in milliseconds for each `sessionStore.load()` /
   * `sessionStore.listSubkeys()` call during resume materialization.
   *
   * @default 60000
   * @alpha Subject to change in upstream Agent SDK releases.
   */
  loadTimeoutMs?: number;

  /**
   * Custom function to spawn the Claude Code process.
   * Use this to run Claude Code in VMs, containers, or remote environments.
   */
  spawnClaudeCodeProcess?: (options: SpawnOptions) => SpawnedProcess;

  /**
   * Escape hatch for Agent SDK options. Overrides explicit settings.
   * Provider-managed fields (e.g. model, abortController, prompt, outputFormat)
   * are ignored if supplied here.
   */
  sdkOptions?: Partial<Options>;

  /**
   * Maximum size (in characters) for tool results sent to the client stream.
   * The interior Claude Code process retains full data; this only affects client stream.
   * Tool results exceeding this size will be truncated with a `...[truncated N chars]` suffix.
   * @default 10000
   */
  maxToolResultSize?: number;

  /**
   * Callback invoked when the Query object is created.
   * Use this to access the Query for advanced features like mid-stream
   * message injection via `query.streamInput()`.
   *
   * @example
   * ```typescript
   * const model = claudeCode('sonnet', {
   *   onQueryCreated: (query) => {
   *     // Store query for later injection
   *     myQueryStore.set(sessionId, query);
   *   }
   * });
   * ```
   */
  onQueryCreated?: (query: Query) => void;

  /**
   * Callback invoked when streaming input mode starts.
   * Provides a MessageInjector that can be used to inject messages mid-session.
   *
   * This enables supervisor patterns where you can redirect or interrupt
   * the agent during execution.
   *
   * @example
   * ```typescript
   * const model = claudeCode("haiku", {
   *   streamingInput: "always",
   *   onStreamStart: (injector) => {
   *     // Store the injector for later use
   *     supervisorInjector = injector;
   *   }
   * });
   *
   * // Later, inject a message mid-session:
   * supervisorInjector.inject("STOP! Change of plans...");
   * ```
   */
  onStreamStart?: (injector: MessageInjector) => void;

  /**
   * Callback invoked when the agent emits a prompt suggestion (a predicted
   * next user prompt). Requires `promptSuggestions: true`.
   *
   * The SDK emits at most one `prompt_suggestion` message per turn, and it
   * arrives AFTER the `result` message — i.e. after the AI SDK response has
   * already finished. That is why suggestions are delivered through this
   * callback instead of `providerMetadata` (which is finalized with the
   * finish event/result).
   *
   * @example
   * ```typescript
   * const model = claudeCode('sonnet', {
   *   promptSuggestions: true,
   *   onPromptSuggestion: (suggestion) => {
   *     console.log('Suggested next prompt:', suggestion);
   *   }
   * });
   * ```
   */
  onPromptSuggestion?: (suggestion: string) => void;
}

/**
 * Controller for injecting messages into an active Claude Code session.
 * Obtained via the onStreamStart callback.
 */
export interface MessageInjector {
  /**
   * Inject a user message into the current session.
   * The message will be queued and sent to the agent mid-turn.
   *
   * @param content - The message content to inject
   * @param onResult - Optional callback invoked when delivery status is known:
   *   - `delivered: true` if the message was sent to the agent
   *   - `delivered: false` if the session ended before the message could be delivered
   *
   * @example
   * ```typescript
   * // Fire-and-forget
   * injector.inject("STOP! Cancel the current task.");
   *
   * // With delivery tracking
   * injector.inject("Change of plans!", (delivered) => {
   *   if (!delivered) {
   *     console.log("Message not delivered - session ended first");
   *     // Handle retry via session resume, etc.
   *   }
   * });
   * ```
   */
  inject(content: string, onResult?: (delivered: boolean) => void): void;

  /**
   * Signal that no more messages will be injected.
   * Call this when the session should be allowed to complete normally.
   */
  close(): void;
}
