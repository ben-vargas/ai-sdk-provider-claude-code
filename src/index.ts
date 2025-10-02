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
 * This class implements the AI SDK's LanguageModelV1 interface.
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
export type { ClaudeCodeSettings, Logger } from './types.js';

// Convenience re-exports from the SDK for custom tools and hooks
export { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
export { createCustomMcpServer } from './mcp-helpers.js';
export type {
  HookEvent,
  HookCallback,
  HookCallbackMatcher,
  HookInput,
  HookJSONOutput,
  PreToolUseHookInput,
  PostToolUseHookInput,
  UserPromptSubmitHookInput,
  SessionStartHookInput,
  SessionEndHookInput,
  CanUseTool,
  PermissionResult,
  PermissionUpdate,
  PermissionBehavior,
  PermissionRuleValue,
  McpServerConfig,
  McpSdkServerConfigWithInstance,
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
