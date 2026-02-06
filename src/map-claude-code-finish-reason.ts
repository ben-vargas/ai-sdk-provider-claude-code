import type { LanguageModelV3FinishReason } from '@ai-sdk/provider';

/**
 * Maps Claude Code SDK result subtypes to AI SDK finish reasons.
 *
 * When `stopReason` is provided (from the SDK's `stop_reason` field), it takes
 * priority for mapping well-known Anthropic API stop reasons. Otherwise, falls
 * back to the existing subtype-based mapping.
 *
 * @param subtype - The result subtype from Claude Code SDK
 * @param stopReason - The optional stop_reason from SDKResultSuccess/SDKResultError (v0.2.31+)
 * @returns The corresponding AI SDK finish reason with unified and raw values
 *
 * @example
 * ```typescript
 * // With stop_reason (preferred when available)
 * mapClaudeCodeFinishReason('success', 'end_turn');
 * // Returns: { unified: 'stop', raw: 'end_turn' }
 *
 * // Without stop_reason (backward compatible)
 * mapClaudeCodeFinishReason('error_max_turns');
 * // Returns: { unified: 'length', raw: 'error_max_turns' }
 * ```
 */
export function mapClaudeCodeFinishReason(
  subtype?: string,
  stopReason?: string | null
): LanguageModelV3FinishReason {
  // When stop_reason is present and non-null, map known Anthropic API stop reasons
  if (stopReason != null) {
    switch (stopReason) {
      case 'end_turn':
        return { unified: 'stop', raw: 'end_turn' };
      case 'max_tokens':
        return { unified: 'length', raw: 'max_tokens' };
      case 'stop_sequence':
        return { unified: 'stop', raw: 'stop_sequence' };
      case 'tool_use':
        return { unified: 'tool-calls', raw: 'tool_use' };
      default:
        // Unknown stop_reason: fall back to subtype mapping but preserve stop_reason as raw
        break;
    }
  }

  // Fall back to subtype-based mapping
  const raw = stopReason ?? subtype;
  switch (subtype) {
    case 'success':
      return { unified: 'stop', raw };
    case 'error_max_turns':
      return { unified: 'length', raw };
    case 'error_during_execution':
      return { unified: 'error', raw };
    case undefined:
      return { unified: 'stop', raw };
    default:
      return { unified: 'other', raw };
  }
}
