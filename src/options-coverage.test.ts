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
import type { Options } from '@anthropic-ai/claude-agent-sdk';

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
  | 'sandbox'
  | 'tools'
  | 'mcpServers'
  | 'canUseTool'
  // --- conditionally-set block (only assigned when the setting is defined) ---
  | 'onUserDialog'
  | 'supportedDialogKinds'
  | 'systemPrompt' // also fed by deprecated customSystemPrompt/appendSystemPrompt
  | 'settingSources' // pinned to [] when unset (isolation default)
  | 'additionalDirectories'
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
 * Consciously not exposed as `ClaudeCodeSettings`. Each entry needs a reason.
 * All remain reachable through the `sdkOptions` escape hatch.
 */
type KnownExcludedKey =
  // Selects a named agent persona for the MAIN thread (its prompt/tools/model
  // override the conversation) — conflicts with the AI SDK contract where the
  // model id and system prompt come from the AI SDK call itself.
  | 'agent'
  // Interactive host-UI callback for MCP elicitation (form/URL-auth prompts);
  // headless AI SDK usage has no dialog surface, and unhandled requests are
  // safely auto-declined by the SDK.
  | 'onElicitation';

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
});
