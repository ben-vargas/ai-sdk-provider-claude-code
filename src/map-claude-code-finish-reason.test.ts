import { describe, it, expect } from 'vitest';
import { mapClaudeCodeFinishReason } from './map-claude-code-finish-reason.js';

describe('mapClaudeCodeFinishReason', () => {
  it('should map success to stop', () => {
    expect(mapClaudeCodeFinishReason('success')).toBe('stop');
  });

  it('should map error_max_turns to length', () => {
    expect(mapClaudeCodeFinishReason('error_max_turns')).toBe('length');
  });

  it('should map error_during_execution to error', () => {
    expect(mapClaudeCodeFinishReason('error_during_execution')).toBe('error');
  });

  it('should map unknown subtypes to stop', () => {
    expect(mapClaudeCodeFinishReason('unknown_subtype')).toBe('stop');
    expect(mapClaudeCodeFinishReason('custom')).toBe('stop');
    expect(mapClaudeCodeFinishReason('')).toBe('stop');
  });

  it('should handle undefined subtype', () => {
    expect(mapClaudeCodeFinishReason(undefined)).toBe('stop');
  });

  it('should handle null subtype', () => {
    expect(mapClaudeCodeFinishReason(null as unknown as string | undefined)).toBe('stop');
  });

  it('should be case sensitive', () => {
    // These should map to default 'stop' as they don't match exactly
    expect(mapClaudeCodeFinishReason('Success')).toBe('stop');
    expect(mapClaudeCodeFinishReason('ERROR_MAX_TURNS')).toBe('stop');
    expect(mapClaudeCodeFinishReason('Error_During_Execution')).toBe('stop');
  });
});
