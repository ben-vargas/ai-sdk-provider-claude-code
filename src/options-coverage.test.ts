/**
 * SDK Options drift guard (compile-time).
 *
 * Partitions `keyof Options` from @anthropic-ai/claude-agent-sdk into three
 * exhaustive, documented buckets:
 *
 *   1. MappedKey          — fields `createQueryOptions` actually forwards
 *                           (from `ClaudeCodeSettings` or built internally).
 *   2. ProviderManagedKey — fields the provider owns outright; consumers may
 *                           not override them (see SDK_OPTIONS_BLOCKLIST in
 *                           claude-code-language-model.ts).
 *   3. KnownExcludedKey   — fields consciously not exposed, each with a
 *                           one-line reason. Still reachable via the
 *                           `sdkOptions` escape hatch.
 *
 * When the SDK adds a new `Options` field, `npm run typecheck` (and any
 * type-aware editor) fails on the `Record<..., never>` guards below with the
 * NEW KEY'S NAME in the error message, e.g.:
 *
 *   error TS2739: Type '{}' is missing the following properties from type
 *   'Record<UnaccountedSdkOptionKey, never>': someNewOption
 *
 * Fix by either mapping the field in `createQueryOptions` (and adding it to
 * `MappedKey`), or adding it to `KnownExcludedKey` with a reason.
 */
import { describe, expect, it } from 'vitest';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * Every `Options` field that `createQueryOptions` in
 * src/claude-code-language-model.ts forwards to the SDK.
 */
type MappedKey =
  // --- always-set block (assigned unconditionally from settings/internals) ---
  | 'resume'
  | 'pathToClaudeCodeExecutable'
  | 'maxTurns'
  | 'maxThinkingTokens'
  | 'thinking'
  | 'effort'
  | 'promptSuggestions'
  | 'cwd'
  | 'executable'
  | 'executableArgs'
  | 'permissionMode'
  | 'permissionPromptToolName'
  | 'continue'
  | 'allowedTools'
  | 'disallowedTools'
  | 'betas'
  | 'allowDangerouslySkipPermissions'
  | 'enableFileCheckpointing'
  | 'maxBudgetUsd'
  | 'plugins'
  | 'resumeSessionAt'
  | 'resumeDropsTurn'
  | 'sandbox'
  | 'tools'
  | 'mcpServers'
  | 'canUseTool'
  // --- conditionally-set block (only assigned when the setting is defined) ---
  | 'onUserDialog'
  | 'onElicitation'
  | 'supportedDialogKinds'
  | 'systemPrompt' // also fed by deprecated customSystemPrompt/appendSystemPrompt
  | 'settingSources' // pinned to [] when unset (isolation default)
  | 'additionalDirectories'
  | 'agent'
  | 'agents'
  | 'skills'
  | 'settings'
  | 'managedSettings'
  | 'toolAliases'
  | 'toolConfig'
  | 'planModeInstructions'
  | 'title'
  | 'forwardSubagentText'
  | 'agentProgressSummaries'
  | 'includeHookEvents'
  | 'perTaskStopAffordance'
  | 'taskBudget' // alpha passthrough
  | 'sessionStore' // alpha passthrough
  | 'sessionStoreFlush' // alpha passthrough
  | 'loadTimeoutMs' // alpha passthrough
  | 'includePartialMessages'
  | 'fallbackModel'
  | 'forkSession'
  | 'strictMcpConfig'
  | 'extraArgs'
  | 'persistSession'
  | 'spawnClaudeCodeProcess'
  | 'hooks'
  | 'sessionId'
  | 'debug'
  | 'debugFile'
  // --- provider-constructed (built internally, user input merged in) ---
  | 'stderr' // wrapped: error-reporting collector + settings/sdkOptions callback
  | 'env'; // always built from the sanitizing allowlist + settings.env + sdkOptions.env

/**
 * Fields the provider manages itself; rejected from `sdkOptions` via
 * SDK_OPTIONS_BLOCKLIST. ('prompt' is also blocklisted but is the first
 * positional argument of query(), not an `Options` key.)
 */
type ProviderManagedKey =
  | 'model' // derived from the AI SDK model id
  | 'abortController' // owned by the provider for AI SDK abort-signal wiring
  | 'outputFormat'; // derived from the AI SDK responseFormat (json_schema)

/**
 * SDK Options currently have no intentionally-unmapped provider settings.
 * New exclusions must be documented here with a product reason.
 */
type KnownExcludedKey = never;

type AccountedKey = MappedKey | ProviderManagedKey | KnownExcludedKey;

/**
 * New SDK `Options` fields land here. Must stay `never` — a non-never union
 * means the SDK added option(s) this provider neither maps nor consciously
 * excludes.
 */
type UnaccountedSdkOptionKey = Exclude<keyof Options, AccountedKey>;

/**
 * Keys listed above that no longer exist upstream (removed/renamed). Must stay
 * `never` so the partition cannot rot in the other direction.
 */
type StaleAccountedKey = Exclude<AccountedKey, keyof Options>;

type IsAny<T> = 0 extends 1 & T ? true : false;
type HasAnyKeyspace<T> = string extends keyof T ? true : false;

/**
 * Broken published SDK declarations can reference missing union members. With
 * skipLibCheck, those missing names collapse `SDKMessage` to `any`; canary must
 * fail loudly/actionably here instead of leaking stray TS7006s elsewhere.
 */
type CollapsedSdkMessageAnyKey =
  HasAnyKeyspace<SDKMessage> extends true
    ? 'SDKMessage_collapsed_to_any__fix_upstream_claude_agent_sdk_dts_missing_union_members'
    : IsAny<SDKMessage> extends true
      ? 'SDKMessage_collapsed_to_any__fix_upstream_claude_agent_sdk_dts_missing_union_members'
      : never;

// Compile-time guards. `Record<never, never>` is `{}`, so these only compile
// while the corresponding union is empty; otherwise tsc names the missing
// key(s), e.g.:
//   Type '{}' is missing the following properties from type
//   'Record<UnaccountedSdkOptionKey, never>': someNewOption
const unaccountedSdkOptionKeys: Record<UnaccountedSdkOptionKey, never> = {};
const staleAccountedKeys: Record<StaleAccountedKey, never> = {};
const mappedKeysOverlappingOtherBuckets: Record<
  Extract<MappedKey, ProviderManagedKey | KnownExcludedKey>,
  never
> = {};
const providerManagedKeysOverlappingExcluded: Record<
  Extract<ProviderManagedKey, KnownExcludedKey>,
  never
> = {};
const sdkMessageMustNotCollapseToAny: Record<CollapsedSdkMessageAnyKey, never> = {};

describe('SDK Options drift guard', () => {
  it('accounts for every key of the SDK Options type', () => {
    // The real assertion is the compile-time Record guard above.
    expect(Object.keys(unaccountedSdkOptionKeys)).toEqual([]);
  });

  it('lists no keys that the SDK has removed or renamed', () => {
    expect(Object.keys(staleAccountedKeys)).toEqual([]);
  });

  it('keeps the three buckets disjoint', () => {
    expect(Object.keys(mappedKeysOverlappingOtherBuckets)).toEqual([]);
    expect(Object.keys(providerManagedKeysOverlappingExcluded)).toEqual([]);
  });

  it('keeps SDKMessage from collapsing to any', () => {
    expect(Object.keys(sdkMessageMustNotCollapseToAny)).toEqual([]);
  });
});
