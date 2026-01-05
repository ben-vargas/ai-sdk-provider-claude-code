// Import types from the SDK
import type {
  PermissionMode,
  McpServerConfig,
  CanUseTool,
  SdkBeta,
  SandboxSettings,
  SdkPluginConfig,
  Options,
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
   * - preset object: Claude Code preset, with optional append
   */
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append?: string };

  /**
   * Maximum number of turns for the conversation
   */
  maxTurns?: number;

  /**
   * Maximum thinking tokens for the model
   */
  maxThinkingTokens?: number;

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
   * Permission mode for tool usage
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
   */
  sandbox?: SandboxSettings;

  /**
   * Tool configuration (array of tool names or Claude Code preset).
   */
  tools?: Options['tools'];

  /**
   * MCP server configuration
   */
  mcpServers?: Record<string, McpServerConfig>;

  /**
   * Filesystem settings sources to load (CLAUDE.md, settings.json, etc.)
   * When omitted, the Agent SDK loads no filesystem settings.
   *
   * Required for Skills support - skills are loaded from these sources.
   * @example ['user', 'project']
   */
  settingSources?: Array<'user' | 'project' | 'local'>;

  /**
   * Hook callbacks for lifecycle events (e.g., PreToolUse, PostToolUse).
   * Note: typed loosely to support multiple SDK versions.
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
   */
  canUseTool?: CanUseTool;

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
   * Environment variables to set
   */
  env?: Record<string, string | undefined>;

  /**
   * Additional directories Claude can access.
   */
  additionalDirectories?: string[];

  /**
   * Programmatically defined subagents.
   */
  agents?: Record<
    string,
    {
      description: string;
      tools?: string[];
      prompt: string;
      model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
    }
  >;

  /**
   * Include partial message events from the SDK stream.
   */
  includePartialMessages?: boolean;

  /**
   * Model to use if primary fails.
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
   * Escape hatch for Agent SDK options. Overrides explicit settings.
   * Provider-managed fields (e.g. model, abortController, prompt, outputFormat)
   * are ignored if supplied here.
   */
  sdkOptions?: Partial<Options>;
}
