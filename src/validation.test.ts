import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  claudeCodeSettingsSchema,
  validateModelId,
  validateSettings,
  validatePrompt,
  validateSessionId
} from './validation.js';
import * as fs from 'fs';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn()
}));

describe('claudeCodeSettingsSchema', () => {
  it('should accept valid settings', () => {
    const validSettings = {
      pathToClaudeCodeExecutable: '/usr/bin/claude',
      customSystemPrompt: 'You are helpful',
      maxTurns: 10,
      maxThinkingTokens: 50000,
      executable: 'node',
      executableArgs: ['--experimental'],
      continue: true,
      resume: 'session-123',
      allowedTools: ['Read', 'Write'],
      disallowedTools: ['Bash'],
      verbose: true
    };
    
    const result = claudeCodeSettingsSchema.safeParse(validSettings);
    expect(result.success).toBe(true);
  });

  it('should reject invalid maxTurns', () => {
    const settings = { maxTurns: 0 };
    const result = claudeCodeSettingsSchema.safeParse(settings);
    expect(result.success).toBe(false);
    if (!result.success) {
      // Support both Zod v3 (errors) and v4 (issues)
      const issues = (result.error as any).errors || result.error.issues;
      // Support both v3 and v4 error message formats
      expect(issues[0].message).toMatch(/greater than or equal to 1|Too small.*>=1/);
    }
  });

  it('should reject invalid executable', () => {
    const settings = { executable: 'python' as any };
    const result = claudeCodeSettingsSchema.safeParse(settings);
    expect(result.success).toBe(false);
  });

  it('should accept empty settings object', () => {
    const result = claudeCodeSettingsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should reject unknown properties', () => {
    const settings = { unknownProp: 'value' };
    const result = claudeCodeSettingsSchema.safeParse(settings);
    expect(result.success).toBe(false);
  });
});

describe('validateModelId', () => {
  it('should accept known models without warnings', () => {
    expect(validateModelId('opus')).toBeUndefined();
    expect(validateModelId('sonnet')).toBeUndefined();
  });

  it('should warn about unknown models', () => {
    const warning = validateModelId('gpt-4');
    expect(warning).toContain('Unknown model ID: \'gpt-4\'');
    expect(warning).toContain('Known models are: opus, sonnet');
  });

  it('should throw error for empty model ID', () => {
    expect(() => validateModelId('')).toThrow('Model ID cannot be empty');
    expect(() => validateModelId('  ')).toThrow('Model ID cannot be empty');
  });

  it('should throw error for null/undefined model ID', () => {
    expect(() => validateModelId(null as any)).toThrow('Model ID cannot be empty');
    expect(() => validateModelId(undefined as any)).toThrow('Model ID cannot be empty');
  });
});

describe('validateSettings', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should validate correct settings', () => {
    const settings = {
      maxTurns: 10,
      maxThinkingTokens: 30000
    };
    
    const result = validateSettings(settings);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('should warn about high maxTurns', () => {
    const settings = { maxTurns: 50 };
    const result = validateSettings(settings);
    
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('High maxTurns value (50)');
  });

  it('should warn about very high maxThinkingTokens', () => {
    const settings = { maxThinkingTokens: 80000 };
    const result = validateSettings(settings);
    
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Very high maxThinkingTokens (80000)');
  });

  it('should warn when both allowedTools and disallowedTools are specified', () => {
    const settings = {
      allowedTools: ['Read'],
      disallowedTools: ['Write']
    };
    const result = validateSettings(settings);
    
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Both allowedTools and disallowedTools are specified');
  });

  it('should validate tool name formats', () => {
    const settings = {
      allowedTools: ['Read', 'Write', 'Bash(git log:*)', 'mcp__server__tool'],
      disallowedTools: ['123invalid', '@#$bad']
    };
    const result = validateSettings(settings);
    
    expect(result.valid).toBe(true);
    // The function also validates allowed tools, so we may get warnings for non-standard names
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
    // Check that we get warnings about unusual tool names
    const toolWarnings = result.warnings.filter(w => w.includes('Unusual') && w.includes('tool name format'));
    expect(toolWarnings.length).toBeGreaterThanOrEqual(2);
  });

  it('should validate working directory exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    
    const settings = { cwd: '/nonexistent/path' };
    const result = validateSettings(settings);
    
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Working directory must exist');
  });

  it('should handle invalid settings type', () => {
    const result = validateSettings('not an object' as any);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should handle validation exceptions', () => {
    vi.mocked(fs.existsSync).mockImplementation(() => {
      throw new Error('FS error');
    });
    
    const settings = { cwd: '/some/path' };
    const result = validateSettings(settings);
    
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Validation error: FS error');
  });

  it('should validate permissionMode values', () => {
    // Valid permission modes
    const validModes = ['default', 'acceptEdits', 'bypassPermissions', 'plan'];
    validModes.forEach(mode => {
      const result = validateSettings({ permissionMode: mode });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    // Invalid permission mode
    const invalidResult = validateSettings({ permissionMode: 'invalid' });
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.errors[0]).toContain('permissionMode');
  });

  it('should validate mcpServers configuration', () => {
    // Valid stdio server
    const validStdio = {
      mcpServers: {
        filesystem: {
          command: 'npx',
          args: ['@modelcontextprotocol/server-filesystem'],
          env: { PATH: '/usr/bin' }
        }
      }
    };
    expect(validateSettings(validStdio).valid).toBe(true);

    // Valid stdio server without optional type field
    const validStdioNoType = {
      mcpServers: {
        filesystem: {
          command: 'npx'
        }
      }
    };
    expect(validateSettings(validStdioNoType).valid).toBe(true);

    // Valid SSE server
    const validSSE = {
      mcpServers: {
        apiServer: {
          type: 'sse',
          url: 'https://example.com/sse',
          headers: { 'Authorization': 'Bearer token' }
        }
      }
    };
    expect(validateSettings(validSSE).valid).toBe(true);

    // Valid HTTP server
    const validHTTP = {
      mcpServers: {
        apiServer: {
          type: 'http',
          url: 'https://example.com/api',
          headers: { 'Authorization': 'Bearer token' }
        }
      }
    };
    expect(validateSettings(validHTTP).valid).toBe(true);

    // Invalid - missing required fields
    const invalidMissingCommand = {
      mcpServers: {
        invalid: {
          args: ['test']
        }
      }
    };
    const result1 = validateSettings(invalidMissingCommand);
    expect(result1.valid).toBe(false);
    expect(result1.errors[0]).toContain('mcpServers');

    // Invalid - SSE missing url
    const invalidSSEMissingUrl = {
      mcpServers: {
        invalid: {
          type: 'sse',
          headers: { 'test': 'value' }
        }
      }
    };
    const result2 = validateSettings(invalidSSEMissingUrl);
    expect(result2.valid).toBe(false);
    expect(result2.errors[0]).toContain('mcpServers');

    // Invalid - HTTP missing url
    const invalidHTTPMissingUrl = {
      mcpServers: {
        invalid: {
          type: 'http',
          headers: { 'test': 'value' }
        }
      }
    };
    const result3 = validateSettings(invalidHTTPMissingUrl);
    expect(result3.valid).toBe(false);
    expect(result3.errors[0]).toContain('mcpServers');
  });
});

describe('validatePrompt', () => {
  it('should not warn for normal prompts', () => {
    const normalPrompt = 'Write a function to calculate fibonacci numbers';
    expect(validatePrompt(normalPrompt)).toBeUndefined();
    
    const longButOkPrompt = 'a'.repeat(50000);
    expect(validatePrompt(longButOkPrompt)).toBeUndefined();
  });

  it('should warn for very long prompts', () => {
    const veryLongPrompt = 'x'.repeat(100001);
    const warning = validatePrompt(veryLongPrompt);
    
    expect(warning).toContain('Very long prompt (100001 characters)');
    expect(warning).toContain('may cause performance issues or timeouts');
  });

  it('should handle empty prompts', () => {
    expect(validatePrompt('')).toBeUndefined();
  });
});

describe('validateSessionId', () => {
  it('should accept valid session IDs', () => {
    const validIds = [
      'abc-123-def',
      'session_12345',
      'UUID-4a5b6c7d-8e9f',
      '123456789',
      'test-session'
    ];
    
    validIds.forEach(id => {
      expect(validateSessionId(id)).toBeUndefined();
    });
  });

  it('should warn about unusual session ID formats', () => {
    const unusualIds = [
      'session with spaces',
      'special@characters#',
      'unicode-🔥-session',
      'new\nline',
      'tab\tcharacter'
    ];
    
    unusualIds.forEach(id => {
      const warning = validateSessionId(id);
      expect(warning).toContain('Unusual session ID format');
      expect(warning).toContain('may cause issues with session resumption');
    });
  });

  it('should handle empty session IDs', () => {
    expect(validateSessionId('')).toBeUndefined();
    expect(validateSessionId(null as any)).toBeUndefined();
    expect(validateSessionId(undefined as any)).toBeUndefined();
  });
});