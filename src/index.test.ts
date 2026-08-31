import { describe, it, expect } from 'vitest';
import * as indexExports from './index.js';
import * as providerExports from './claude-code-provider.js';
import * as errorExports from './errors.js';
import type {
  ClaudeCodeSettings,
  ClaudeCodeHookEvent,
  ClaudeCodeMcpStatusEvent,
  ClaudeCodeQueryController,
  ClaudeCodeTaskEvent,
  OnElicitation,
  ResolvedSettings,
  ResolveSettingsOptions,
  ProvenanceEntry,
  ResolvedSettingSource,
  PolicySettingsOrigin,
  HookInput,
  PreModelSwitchHookInput,
  PostModelSwitchHookInput,
  DirectoryAddedHookInput,
  PreModelSwitchHookSpecificOutput,
  PostModelSwitchHookSpecificOutput,
} from './index.js';

type SdkCallbackSettingsOptions = Pick<
  ClaudeCodeSettings,
  | 'onSdkMessage'
  | 'onTaskEvent'
  | 'onHookEvent'
  | 'onMcpStatusChange'
  | 'onElicitation'
  | 'agent'
  | 'onQueryControllerCreated'
>;

type SdkCallbackExportedTypes = [
  ClaudeCodeTaskEvent,
  ClaudeCodeHookEvent,
  ClaudeCodeMcpStatusEvent,
  ClaudeCodeQueryController,
  OnElicitation,
  ResolvedSettings,
  ResolveSettingsOptions,
  ProvenanceEntry,
  ResolvedSettingSource,
  PolicySettingsOrigin,
  SdkCallbackSettingsOptions,
];

const sdkCallbackExportedTypesCompileCheck: SdkCallbackExportedTypes | null = null;

// Compile-time check that the hook types added through SDK 0.3.251 are
// re-exported from the package entry point and stay members of the HookInput
// union (runtime HOOK_EVENTS assertions cannot see type-only exports).
type MemberOfHookInput<T extends HookInput> = T;
type HookSurfaceExportedTypes = [
  MemberOfHookInput<PreModelSwitchHookInput>,
  MemberOfHookInput<PostModelSwitchHookInput>,
  MemberOfHookInput<DirectoryAddedHookInput>,
  PreModelSwitchHookSpecificOutput,
  PostModelSwitchHookSpecificOutput,
];

const hookSurfaceExportedTypesCompileCheck: HookSurfaceExportedTypes | null = null;

describe('index exports', () => {
  it('should export all expected functions and types', () => {
    // Provider exports
    expect(indexExports.createClaudeCode).toBeDefined();
    expect(typeof indexExports.createClaudeCode).toBe('function');
    expect(indexExports.claudeCode).toBeDefined();
    expect(typeof indexExports.claudeCode).toBe('function');

    // Language model exports
    expect(indexExports.ClaudeCodeLanguageModel).toBeDefined();
    expect(typeof indexExports.ClaudeCodeLanguageModel).toBe('function');

    expect(indexExports.createClaudeCodeQueryController).toBeDefined();
    expect(typeof indexExports.createClaudeCodeQueryController).toBe('function');

    // Error handling exports
    expect(indexExports.isAuthenticationError).toBeDefined();
    expect(typeof indexExports.isAuthenticationError).toBe('function');
    expect(indexExports.isTimeoutError).toBeDefined();
    expect(typeof indexExports.isTimeoutError).toBe('function');
    expect(indexExports.getErrorMetadata).toBeDefined();
    expect(typeof indexExports.getErrorMetadata).toBe('function');
    expect(indexExports.createAPICallError).toBeDefined();
    expect(typeof indexExports.createAPICallError).toBe('function');
    expect(indexExports.createAuthenticationError).toBeDefined();
    expect(typeof indexExports.createAuthenticationError).toBe('function');
    expect(indexExports.createTimeoutError).toBeDefined();
    expect(typeof indexExports.createTimeoutError).toBe('function');

    // SDK passthroughs
    expect(indexExports.createSdkMcpServer).toBeDefined();
    expect(typeof indexExports.createSdkMcpServer).toBe('function');
    expect(indexExports.tool).toBeDefined();
    expect(typeof indexExports.tool).toBe('function');
    expect(indexExports.SYSTEM_PROMPT_DYNAMIC_BOUNDARY).toBeDefined();
    expect(typeof indexExports.SYSTEM_PROMPT_DYNAMIC_BOUNDARY).toBe('string');
    expect(indexExports.InMemorySessionStore).toBeDefined();
    expect(typeof indexExports.InMemorySessionStore).toBe('function');
    expect(indexExports.HOOK_EVENTS).toBeDefined();
    expect(Array.isArray(indexExports.HOOK_EVENTS)).toBe(true);
    expect(indexExports.HOOK_EVENTS).toContain('PreToolUse');
    expect(indexExports.HOOK_EVENTS).toContain('PreModelSwitch');
    expect(indexExports.HOOK_EVENTS).toContain('PostModelSwitch');
    expect(indexExports.HOOK_EVENTS).toContain('DirectoryAdded');
    expect(indexExports.AbortError).toBeDefined();
    expect(typeof indexExports.AbortError).toBe('function');

    // Session lifecycle helpers (SDK passthroughs)
    expect(indexExports.listSessions).toBeDefined();
    expect(typeof indexExports.listSessions).toBe('function');
    expect(indexExports.getSessionMessages).toBeDefined();
    expect(typeof indexExports.getSessionMessages).toBe('function');
    expect(indexExports.forkSession).toBeDefined();
    expect(typeof indexExports.forkSession).toBe('function');
    expect(indexExports.getSessionInfo).toBeDefined();
    expect(typeof indexExports.getSessionInfo).toBe('function');
    expect(indexExports.deleteSession).toBeDefined();
    expect(typeof indexExports.deleteSession).toBe('function');
    expect(indexExports.renameSession).toBeDefined();
    expect(typeof indexExports.renameSession).toBe('function');
    expect(indexExports.tagSession).toBeDefined();
    expect(typeof indexExports.tagSession).toBe('function');
    expect(indexExports.listSubagents).toBeDefined();
    expect(typeof indexExports.listSubagents).toBe('function');
    expect(indexExports.getSubagentMessages).toBeDefined();
    expect(typeof indexExports.getSubagentMessages).toBe('function');
    expect(indexExports.foldSessionSummary).toBeDefined();
    expect(typeof indexExports.foldSessionSummary).toBe('function');
    expect(indexExports.importSessionToStore).toBeDefined();
    expect(typeof indexExports.importSessionToStore).toBe('function');

    // Warm-start helper (SDK passthrough)
    expect(indexExports.startup).toBeDefined();
    expect(typeof indexExports.startup).toBe('function');
  });

  it('should export correct modules', () => {
    // Check that exported functions are the same references
    expect(indexExports.createClaudeCode).toBe(providerExports.createClaudeCode);
    expect(indexExports.claudeCode).toBe(providerExports.claudeCode);
    expect(indexExports.isAuthenticationError).toBe(errorExports.isAuthenticationError);
    expect(indexExports.isTimeoutError).toBe(errorExports.isTimeoutError);
  });

  it('should export Agent SDK callback and controller public types', () => {
    expect(sdkCallbackExportedTypesCompileCheck).toBeNull();
  });

  it('should export the SDK 0.3.251 hook surface types', () => {
    expect(hookSurfaceExportedTypesCompileCheck).toBeNull();
  });
});
