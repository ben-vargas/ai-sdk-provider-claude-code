import type { LanguageModelV3FinishReason } from '@ai-sdk/provider';

/**
 * Maps Claude Code SDK result subtypes to AI SDK finish reasons.
 *
 * @param subtype - The result subtype from Claude Code SDK
 * @returns The corresponding AI SDK finish reason with unified and raw values
 *
 * @example
 * ```typescript
 * const finishReason = mapClaudeCodeFinishReason('error_max_turns');
 * // Returns: { unified: 'length', raw: 'error_max_turns' }
 * ```
 *
 * @remarks
 * Mappings:
 * - 'success' -> { unified: 'stop', raw: 'success' } (normal completion)
 * - 'error_max_turns' -> { unified: 'length', raw: 'error_max_turns' } (hit turn limit)
 * - 'error_during_execution' -> { unified: 'error', raw: 'error_during_execution' } (execution error)
 * - undefined -> { unified: 'stop', raw: undefined } (no subtype provided)
 * - unknown -> { unified: 'other', raw: subtype } (unknown subtypes)
 */
export function mapClaudeCodeFinishReason(subtype?: string): LanguageModelV3FinishReason {
  switch (subtype) {
    case 'success':
      return { unified: 'stop', raw: subtype };
    case 'error_max_turns':
      return { unified: 'length', raw: subtype };
    case 'error_during_execution':
      return { unified: 'error', raw: subtype };
    case undefined:
      return { unified: 'stop', raw: undefined };
    default:
      // Unknown subtypes mapped to 'other' to distinguish from genuine completion
      return { unified: 'other', raw: subtype };
  }
}
