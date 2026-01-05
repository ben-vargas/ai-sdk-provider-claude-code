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
});
