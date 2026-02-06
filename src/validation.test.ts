import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  claudeCodeSettingsSchema,
  validateModelId,
  validateSettings,
  validatePrompt,
  validateSessionId,
} from './validation.js';
import * as fs from 'fs';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
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
      betas: ['context-1m-2025-08-07'],
      allowDangerouslySkipPermissions: true,
      enableFileCheckpointing: true,
      maxBudgetUsd: 2.5,
      plugins: [{ type: 'local', path: './plugins/my-plugin' }],
      resumeSessionAt: 'message-uuid',
      sandbox: { enabled: true },
      tools: ['Read', 'Write'],
      verbose: true,
      env: { BASH_DEFAULT_TIMEOUT_MS: '10' },
      sdkOptions: { maxTurns: 3 },
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

  it('should accept env as a record of strings', () => {
    const settings = { env: { PATH: '/usr/bin', FOO: 'bar' } };
    const result = claudeCodeSettingsSchema.safeParse(settings);
    expect(result.success).toBe(true);
  });

  it('should accept env values that are undefined', () => {
    const settings = { env: { PATH: '/usr/bin', UNSET: undefined } };
    const result = claudeCodeSettingsSchema.safeParse(settings);
    expect(result.success).toBe(true);
  });

  it('should reject env values that are not strings', () => {
    const settings = { env: { NUM: 123 as any } };
    const result = claudeCodeSettingsSchema.safeParse(settings);
    expect(result.success).toBe(false);
  });

  it('should accept sessionId as a string', () => {
    const settings = { sessionId: 'my-custom-session-id' };
    const result = claudeCodeSettingsSchema.safeParse(settings);
    expect(result.success).toBe(true);
  });

  it('should reject sessionId when not a string', () => {
    const settings = { sessionId: 123 as any };
    const result = claudeCodeSettingsSchema.safeParse(settings);
    expect(result.success).toBe(false);
  });

  it('should accept debug as a boolean', () => {
    const result = claudeCodeSettingsSchema.safeParse({ debug: true });
    expect(result.success).toBe(true);
    const result2 = claudeCodeSettingsSchema.safeParse({ debug: false });
    expect(result2.success).toBe(true);
  });

  it('should reject debug when not a boolean', () => {
    const result = claudeCodeSettingsSchema.safeParse({ debug: 'yes' as any });
    expect(result.success).toBe(false);
  });

  it('should accept debugFile as a string', () => {
    const result = claudeCodeSettingsSchema.safeParse({ debugFile: '/tmp/debug.log' });
    expect(result.success).toBe(true);
  });

  it('should reject debugFile when not a string', () => {
    const result = claudeCodeSettingsSchema.safeParse({ debugFile: 42 as any });
    expect(result.success).toBe(false);
  });
});

describe('validateModelId', () => {
  it('should accept known models without warnings', () => {
    expect(validateModelId('opus')).toBeUndefined();
    expect(validateModelId('sonnet')).toBeUndefined();
    expect(validateModelId('haiku')).toBeUndefined();
  });

  it('should warn about unknown models', () => {
    const warning = validateModelId('gpt-4');
    expect(warning).toContain("Unknown model ID: 'gpt-4'");
    expect(warning).toContain('Known models are: opus, sonnet, haiku');
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
      maxThinkingTokens: 30000,
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
      disallowedTools: ['Write'],
    };
    const result = validateSettings(settings);

    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Both allowedTools and disallowedTools are specified');
  });

  it('should validate tool name formats', () => {
    const settings = {
      allowedTools: ['Read', 'Write', 'Bash(git log:*)', 'mcp__server__tool'],
      disallowedTools: ['123invalid', '@#$bad'],
    };
    const result = validateSettings(settings);

    expect(result.valid).toBe(true);
    // The function also validates allowed tools, so we may get warnings for non-standard names
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
    // Check that we get warnings about unusual tool names
    const toolWarnings = result.warnings.filter(
      (w) => w.includes('Unusual') && w.includes('tool name format')
    );
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
    // Valid permission modes (including delegate and dontAsk added in SDK 0.2.x)
    const validModes = [
      'default',
      'acceptEdits',
      'bypassPermissions',
      'plan',
      'delegate',
      'dontAsk',
    ];
    validModes.forEach((mode) => {
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
          env: { PATH: '/usr/bin' },
        },
      },
    };
    expect(validateSettings(validStdio).valid).toBe(true);

    // Valid stdio server without optional type field
    const validStdioNoType = {
      mcpServers: {
        filesystem: {
          command: 'npx',
        },
      },
    };
    expect(validateSettings(validStdioNoType).valid).toBe(true);

    // Valid SSE server
    const validSSE = {
      mcpServers: {
        apiServer: {
          type: 'sse',
          url: 'https://example.com/sse',
          headers: { Authorization: 'Bearer token' },
        },
      },
    };
    expect(validateSettings(validSSE).valid).toBe(true);

    // Valid HTTP server
    const validHTTP = {
      mcpServers: {
        apiServer: {
          type: 'http',
          url: 'https://example.com/api',
          headers: { Authorization: 'Bearer token' },
        },
      },
    };
    expect(validateSettings(validHTTP).valid).toBe(true);

    // Invalid - missing required fields
    const invalidMissingCommand = {
      mcpServers: {
        invalid: {
          args: ['test'],
        },
      },
    };
    const result1 = validateSettings(invalidMissingCommand);
    expect(result1.valid).toBe(false);
    expect(result1.errors[0]).toContain('mcpServers');

    // Invalid - SSE missing url
    const invalidSSEMissingUrl = {
      mcpServers: {
        invalid: {
          type: 'sse',
          headers: { test: 'value' },
        },
      },
    };
    const result2 = validateSettings(invalidSSEMissingUrl);
    expect(result2.valid).toBe(false);
    expect(result2.errors[0]).toContain('mcpServers');

    // Invalid - HTTP missing url
    const invalidHTTPMissingUrl = {
      mcpServers: {
        invalid: {
          type: 'http',
          headers: { test: 'value' },
        },
      },
    };
    const result3 = validateSettings(invalidHTTPMissingUrl);
    expect(result3.valid).toBe(false);
    expect(result3.errors[0]).toContain('mcpServers');
  });

  it('should validate hooks and canUseTool settings', () => {
    // Valid canUseTool function
    const valid1 = validateSettings({
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
    });
    expect(valid1.valid).toBe(true);

    // Invalid canUseTool
    const invalid1 = validateSettings({ canUseTool: 'not-a-function' as any });
    expect(invalid1.valid).toBe(false);
    expect(invalid1.errors[0]).toContain('canUseTool');

    // Valid hooks
    const validHooks = validateSettings({
      hooks: { PreToolUse: [{ hooks: [async () => ({ continue: true })] }] },
    });
    expect(validHooks.valid).toBe(true);
  });

  it('should validate SDK MCP server configuration (type: sdk)', () => {
    // Valid SDK server
    const validSdk = {
      mcpServers: {
        custom: {
          type: 'sdk',
          name: 'local',
          instance: {},
        },
      },
    };
    expect(validateSettings(validSdk).valid).toBe(true);

    // Invalid - missing name
    const invalidSdk = {
      mcpServers: {
        bad: {
          type: 'sdk',
          instance: {},
        },
      },
    } as any;
    const res = validateSettings(invalidSdk);
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toContain('mcpServers');
  });

  it('should validate persistSession option', () => {
    // Valid boolean values
    expect(validateSettings({ persistSession: true }).valid).toBe(true);
    expect(validateSettings({ persistSession: false }).valid).toBe(true);

    // Invalid - non-boolean
    const invalidResult = validateSettings({ persistSession: 'true' as any });
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.errors[0]).toContain('persistSession');
  });

  it('should validate spawnClaudeCodeProcess option', () => {
    // Valid function
    const validResult = validateSettings({
      spawnClaudeCodeProcess: () => ({
        stdin: null,
        stdout: null,
        stderr: null,
        kill: () => {},
      }),
    });
    expect(validResult.valid).toBe(true);

    // Invalid - non-function
    const invalidResult = validateSettings({ spawnClaudeCodeProcess: 'not-a-function' as any });
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.errors[0]).toContain('spawnClaudeCodeProcess');
  });

  it('should validate agents with new SDK 0.2.x fields', () => {
    // Valid agent with new fields
    const validAgent = {
      agents: {
        'test-agent': {
          description: 'A test agent',
          prompt: 'You are a test agent',
          tools: ['Read', 'Write'],
          disallowedTools: ['Bash'],
          mcpServers: ['my-server', { custom: { command: 'node', args: ['server.js'] } }],
          criticalSystemReminder_EXPERIMENTAL: 'Remember to be careful',
        },
      },
    };
    expect(validateSettings(validAgent).valid).toBe(true);

    // Valid agent without optional new fields
    const minimalAgent = {
      agents: {
        minimal: {
          description: 'Minimal agent',
          prompt: 'You are minimal',
        },
      },
    };
    expect(validateSettings(minimalAgent).valid).toBe(true);
  });

  describe('Skills configuration warnings', () => {
    it('should warn when Skill is in allowedTools but settingSources is not set', () => {
      const settings = {
        allowedTools: ['Skill', 'Read'],
      };
      const result = validateSettings(settings);

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes("allowedTools includes 'Skill'"))).toBe(true);
      expect(result.warnings.some((w) => w.includes('settingSources is not set'))).toBe(true);
    });

    it('should not warn when Skill is in allowedTools and settingSources is set', () => {
      const settings = {
        allowedTools: ['Skill', 'Read'],
        settingSources: ['user', 'project'] as const,
      };
      const result = validateSettings(settings);

      expect(result.valid).toBe(true);
      // Should not have the Skill warning
      const skillWarnings = result.warnings.filter((w) =>
        w.includes("allowedTools includes 'Skill'")
      );
      expect(skillWarnings).toHaveLength(0);
    });

    it('should not warn when Skill is not in allowedTools', () => {
      const settings = {
        allowedTools: ['Read', 'Write'],
      };
      const result = validateSettings(settings);

      expect(result.valid).toBe(true);
      const skillWarnings = result.warnings.filter((w) => w.includes('Skill'));
      expect(skillWarnings).toHaveLength(0);
    });
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
      'test-session',
    ];

    validIds.forEach((id) => {
      expect(validateSessionId(id)).toBeUndefined();
    });
  });

  it('should warn about unusual session ID formats', () => {
    const unusualIds = [
      'session with spaces',
      'special@characters#',
      'unicode-🔥-session',
      'new\nline',
      'tab\tcharacter',
    ];

    unusualIds.forEach((id) => {
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
