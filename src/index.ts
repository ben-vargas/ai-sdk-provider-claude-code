/**
 * Provider exports for creating and configuring Claude Code instances.
 * @module claude-code
 */

/**
 * Creates a new Claude Code provider instance and the default provider instance.
 * @see {@link createClaudeCode} for creating custom provider instances
 * @see {@link claudeCode} for the default provider instance
 */
export { createClaudeCode, claudeCode } from './claude-code-provider.js';

/**
 * Type definitions for the Claude Code provider.
 * @see {@link ClaudeCodeProvider} for the provider interface
 * @see {@link ClaudeCodeProviderSettings} for provider configuration options
 */
export type { ClaudeCodeProvider, ClaudeCodeProviderSettings } from './claude-code-provider.js';

/**
 * Language model implementation for Claude Code.
 * This class implements the AI SDK's LanguageModelV3 interface.
 */
export { ClaudeCodeLanguageModel } from './claude-code-language-model.js';

/**
 * Type definitions for Claude Code language models.
 * @see {@link ClaudeCodeModelId} for supported model identifiers
 * @see {@link ClaudeCodeLanguageModelOptions} for model configuration options
 */
export type {
  ClaudeCodeModelId,
  ClaudeCodeLanguageModelOptions,
} from './claude-code-language-model.js';

/**
 * Settings for configuring Claude Code behavior.
 * Includes options for customizing the CLI execution, permissions, and tool usage.
 */
export type { ClaudeCodeSettings, Logger, MessageInjector } from './types.js';

// Convenience re-exports from the SDK for custom tools and hooks
export {
  createSdkMcpServer,
  tool,
  // Marker element for string[] systemPrompt cache splitting
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
  // Reference SessionStore implementation (alpha)
  InMemorySessionStore,
  // Value-level companion to the HookEvent type (iterate/validate hook event names)
  HOOK_EVENTS,
  // Error class thrown by the SDK on abort (relevant on the standalone
  // startup()/WarmQuery path, where SDK errors propagate unwrapped)
  AbortError,
} from '@anthropic-ai/claude-agent-sdk';

/**
 * Session lifecycle helpers re-exported from the SDK.
 *
 * These operate on persisted session storage — the local
 * `~/.claude/projects/` JSONL files by default, or a custom `SessionStore`
 * when one is passed via each helper's `sessionStore` option (alpha).
 * See docs/sessions.md for a guide tying these together with the
 * session-related settings (`sessionId`, `resume`, `forkSession`, ...).
 */
export {
  listSessions,
  forkSession,
  getSessionInfo,
  getSessionMessages,
  deleteSession,
  renameSession,
  tagSession,
  listSubagents,
  getSubagentMessages,
  // Pure summary-folding utility for SessionStore implementers (alpha)
  foldSessionSummary,
  // Migrate a local JSONL session into a SessionStore (alpha)
  importSessionToStore,
} from '@anthropic-ai/claude-agent-sdk';

/**
 * Warm-start helper re-exported from the SDK.
 *
 * `startup()` pre-spawns the CLI subprocess and completes its initialize
 * handshake, returning a {@link WarmQuery} handle whose `query()` method
 * writes the prompt to the already-running process (no startup latency).
 *
 * Note: a `WarmQuery` is a standalone SDK query path — it cannot be handed
 * to this provider's `generateText`/`streamText` flow (the SDK exposes no
 * option for passing a pre-warmed handle to `query()`). See the README
 * section "Reducing time-to-first-token (warm start)" for the standalone
 * usage pattern and this limitation.
 */
export { startup } from '@anthropic-ai/claude-agent-sdk';
export { createCustomMcpServer, createAiSdkMcpServer } from './mcp-helpers.js';
export type {
  ToolAnnotations,
  MinimalCallToolResult,
  AiSdkLikeTool,
  AiSdkToolExecuteOptions,
} from './mcp-helpers.js';
export type {
  HookEvent,
  HookCallback,
  HookCallbackMatcher,
  HookInput,
  HookJSONOutput,
  // HookJSONOutput union members
  AsyncHookJSONOutput,
  SyncHookJSONOutput,
  // Hook event inputs (every member of the SDK HookInput union)
  PreToolUseHookInput,
  PostToolUseHookInput,
  PostToolUseFailureHookInput,
  PostToolBatchHookInput,
  PermissionDeniedHookInput,
  NotificationHookInput,
  UserPromptSubmitHookInput,
  UserPromptExpansionHookInput,
  SessionStartHookInput,
  SessionEndHookInput,
  StopHookInput,
  StopFailureHookInput,
  SubagentStartHookInput,
  SubagentStopHookInput,
  PreCompactHookInput,
  PostCompactHookInput,
  PermissionRequestHookInput,
  SetupHookInput,
  TeammateIdleHookInput,
  TaskCreatedHookInput,
  TaskCompletedHookInput,
  ElicitationHookInput,
  ElicitationResultHookInput,
  ConfigChangeHookInput,
  InstructionsLoadedHookInput,
  WorktreeCreateHookInput,
  WorktreeRemoveHookInput,
  CwdChangedHookInput,
  FileChangedHookInput,
  MessageDisplayHookInput,
  // Hook-specific output payloads (SyncHookJSONOutput['hookSpecificOutput'] union members)
  PreToolUseHookSpecificOutput,
  UserPromptSubmitHookSpecificOutput,
  UserPromptExpansionHookSpecificOutput,
  SessionStartHookSpecificOutput,
  SetupHookSpecificOutput,
  SubagentStartHookSpecificOutput,
  PostToolUseHookSpecificOutput,
  PostToolUseFailureHookSpecificOutput,
  PostToolBatchHookSpecificOutput,
  StopHookSpecificOutput,
  SubagentStopHookSpecificOutput,
  PermissionDeniedHookSpecificOutput,
  NotificationHookSpecificOutput,
  PermissionRequestHookSpecificOutput,
  ElicitationHookSpecificOutput,
  ElicitationResultHookSpecificOutput,
  CwdChangedHookSpecificOutput,
  FileChangedHookSpecificOutput,
  WorktreeCreateHookSpecificOutput,
  MessageDisplayHookSpecificOutput,
  // Hook permission decision union (adds 'defer' in SDK 0.3.x)
  HookPermissionDecision,
  // Provenance of a user-role message (peer session, team lead, channel)
  SDKMessageOrigin,
  // Why the turn loop terminated (providerMetadata['claude-code'].terminalReason)
  TerminalReason,
  CanUseTool,
  PermissionResult,
  PermissionUpdate,
  PermissionBehavior,
  PermissionRuleValue,
  // Permission mode union referenced by ClaudeCodeSettings.permissionMode,
  // AgentDefinition.permissionMode, and Query.setPermissionMode()
  PermissionMode,
  // Destination carried by every PermissionUpdate variant
  PermissionUpdateDestination,
  // Provenance of a canUseTool decision (PermissionResult.decisionClassification)
  PermissionDecisionClassification,
  // Blocking user-dialog callback (`onUserDialog` setting) and its request/result shapes
  OnUserDialog,
  UserDialogRequest,
  UserDialogResult,
  // Pre-warmed query handle returned by startup()
  WarmQuery,
  // SDK query() options shape (also accepted by startup() and referenced by
  // ClaudeCodeSettings.systemPrompt/tools/sdkOptions)
  Options,
  McpServerConfig,
  // McpServerConfig union members
  McpStdioServerConfig,
  McpSSEServerConfig,
  McpHttpServerConfig,
  McpSdkServerConfig,
  McpSdkServerConfigWithInstance,
  // Per-agent MCP server map values (AgentMcpServerSpec record values)
  McpServerConfigForProcessTransport,
  OutputFormat,
  SpawnedProcess,
  SpawnOptions,
  AgentMcpServerSpec,
  // Subagent definitions (ClaudeCodeSettings['agents'] values)
  AgentDefinition,
  // Effort levels for the `effort` setting ('low' | 'medium' | 'high' | 'xhigh' | 'max')
  EffortLevel,
  // Settings object shape for the `settings`/`managedSettings` options
  Settings,
  // Per-tool configuration for built-in tools (`toolConfig` option)
  ToolConfig,
  // Session transcript mirroring (alpha `sessionStore` options)
  SessionStore,
  SessionStoreFlush,
  // Session lifecycle helper option/result types
  ListSessionsOptions,
  ForkSessionOptions,
  ForkSessionResult,
  GetSessionInfoOptions,
  GetSessionMessagesOptions,
  GetSubagentMessagesOptions,
  ListSubagentsOptions,
  SessionMutationOptions,
  ImportSessionToStoreOptions,
  // Session metadata returned by getSessionInfo()
  SDKSessionInfo,
  // Transcript message shape returned by getSubagentMessages()
  SessionMessage,
  // Building blocks for custom SessionStore implementations (alpha)
  SessionKey,
  SessionStoreEntry,
  SessionSummaryEntry,
  // Cron task summaries surfaced in session state (referenced by session metadata)
  SessionCronSummary,
  // Query interface for mid-stream message injection via streamInput()
  Query,
  // Messages yielded by Query (AsyncGenerator<SDKMessage>) and accepted by
  // Query.streamInput()/WarmQuery.query() (AsyncIterable<SDKUserMessage>)
  SDKMessage,
  SDKUserMessage,
  // Query method result shapes
  SlashCommand,
  ModelInfo,
  AgentInfo,
  AccountInfo,
  McpServerStatus,
  RewindFilesResult,
  McpSetServersResult,
  // Beta feature identifiers (`betas` setting values)
  SdkBeta,
  // Plugin configuration (`plugins` setting values)
  SdkPluginConfig,
  // Sandbox configuration (`sandbox` setting) and its nested shapes
  SandboxSettings,
  SandboxNetworkConfig,
  SandboxFilesystemConfig,
  SandboxIgnoreViolations,
  // Thinking configuration types
  ThinkingConfig,
  ThinkingAdaptive,
  ThinkingEnabled,
  ThinkingDisabled,
} from '@anthropic-ai/claude-agent-sdk';

/**
 * Error handling utilities for Claude Code.
 * These functions help create and identify specific error types.
 *
 * @see {@link isAuthenticationError} to check for authentication failures
 * @see {@link isTimeoutError} to check for timeout errors
 * @see {@link getErrorMetadata} to extract error metadata
 * @see {@link createAPICallError} to create general API errors
 * @see {@link createAuthenticationError} to create authentication errors
 * @see {@link createTimeoutError} to create timeout errors
 */
export {
  isAuthenticationError,
  isTimeoutError,
  getErrorMetadata,
  createAPICallError,
  createAuthenticationError,
  createTimeoutError,
} from './errors.js';

/**
 * Metadata associated with Claude Code errors.
 * Contains additional context about CLI execution failures.
 */
export type { ClaudeCodeErrorMetadata } from './errors.js';
