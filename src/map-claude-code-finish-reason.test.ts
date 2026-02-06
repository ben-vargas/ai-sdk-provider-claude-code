import { describe, it, expect } from 'vitest';
import { mapClaudeCodeFinishReason } from './map-claude-code-finish-reason.js';

describe('mapClaudeCodeFinishReason', () => {
  it('should map success to stop with raw value', () => {
    expect(mapClaudeCodeFinishReason('success')).toEqual({
      unified: 'stop',
      raw: 'success',
    });
  });

  it('should map error_max_turns to length with raw value', () => {
    expect(mapClaudeCodeFinishReason('error_max_turns')).toEqual({
      unified: 'length',
      raw: 'error_max_turns',
    });
  });

  it('should map error_during_execution to error with raw value', () => {
    expect(mapClaudeCodeFinishReason('error_during_execution')).toEqual({
      unified: 'error',
      raw: 'error_during_execution',
    });
  });

  it('should map unknown subtypes to other with raw value preserved', () => {
    expect(mapClaudeCodeFinishReason('unknown_subtype')).toEqual({
      unified: 'other',
      raw: 'unknown_subtype',
    });
    expect(mapClaudeCodeFinishReason('custom')).toEqual({
      unified: 'other',
      raw: 'custom',
    });
    expect(mapClaudeCodeFinishReason('')).toEqual({
      unified: 'other',
      raw: '',
    });
  });

  it('should handle undefined subtype', () => {
    expect(mapClaudeCodeFinishReason(undefined)).toEqual({
      unified: 'stop',
      raw: undefined,
    });
  });

  it('should handle null subtype as unknown', () => {
    expect(mapClaudeCodeFinishReason(null as unknown as string | undefined)).toEqual({
      unified: 'other',
      raw: null,
    });
  });

  it('should be case sensitive - non-matching cases map to other', () => {
    expect(mapClaudeCodeFinishReason('Success')).toEqual({
      unified: 'other',
      raw: 'Success',
    });
    expect(mapClaudeCodeFinishReason('ERROR_MAX_TURNS')).toEqual({
      unified: 'other',
      raw: 'ERROR_MAX_TURNS',
    });
    expect(mapClaudeCodeFinishReason('Error_During_Execution')).toEqual({
      unified: 'other',
      raw: 'Error_During_Execution',
    });
  });

  describe('stop_reason support', () => {
    it('should map end_turn stop_reason to stop', () => {
      expect(mapClaudeCodeFinishReason('success', 'end_turn')).toEqual({
        unified: 'stop',
        raw: 'end_turn',
      });
    });

    it('should map max_tokens stop_reason to length', () => {
      expect(mapClaudeCodeFinishReason('success', 'max_tokens')).toEqual({
        unified: 'length',
        raw: 'max_tokens',
      });
    });

    it('should map tool_use stop_reason to tool-calls', () => {
      expect(mapClaudeCodeFinishReason('success', 'tool_use')).toEqual({
        unified: 'tool-calls',
        raw: 'tool_use',
      });
    });

    it('should map stop_sequence stop_reason to stop', () => {
      expect(mapClaudeCodeFinishReason('success', 'stop_sequence')).toEqual({
        unified: 'stop',
        raw: 'stop_sequence',
      });
    });

    it('should fall back to subtype mapping when stop_reason is null', () => {
      expect(mapClaudeCodeFinishReason('success', null)).toEqual({
        unified: 'stop',
        raw: 'success',
      });
    });

    it('should fall back to subtype mapping when stop_reason is undefined (backward compat)', () => {
      expect(mapClaudeCodeFinishReason('error_max_turns', undefined)).toEqual({
        unified: 'length',
        raw: 'error_max_turns',
      });
    });

    it('should use unknown stop_reason as raw when falling back to subtype mapping', () => {
      expect(mapClaudeCodeFinishReason('success', 'unknown_reason')).toEqual({
        unified: 'stop',
        raw: 'unknown_reason',
      });
    });
  });
});
