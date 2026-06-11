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

  it('should accept valid effort values', () => {
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
      const result = claudeCodeSettingsSchema.safeParse({ effort });
      expect(result.success).toBe(true);
    }
  });

  it('should reject invalid effort values', () => {
    const result = claudeCodeSettingsSchema.safeParse({ effort: 'turbo' });
    expect(result.success).toBe(false);
  });

  it('should accept valid thinking configurations', () => {
    const configs = [
      { type: 'adaptive' },
      { type: 'adaptive', display: 'summarized' },
      { type: 'adaptive', display: 'omitted' },
      { type: 'enabled', budgetTokens: 10000 },
      { type: 'enabled' },
      { type: 'enabled', budgetTokens: 8000, display: 'omitted' },
      { type: 'enabled', display: 'summarized' },
      { type: 'disabled' },
    ];
    for (const thinking of configs) {
      const result = claudeCodeSettingsSchema.safeParse({ thinking });
      expect(result.success).toBe(true);
    }
  });

  it('should reject invalid thinking configurations', () => {
    const result = claudeCodeSettingsSchema.safeParse({ thinking: { type: 'turbo' } });
    expect(result.success).toBe(false);
  });

  it('should reject invalid thinking display values', () => {
    const cases = [
      { type: 'adaptive', display: 'full' },
      { type: 'enabled', display: 'full' },
      { type: 'disabled', display: 'summarized' }, // ThinkingDisabled has no display
    ];
    for (const thinking of cases) {
      const result = claudeCodeSettingsSchema.safeParse({ thinking });
      expect(result.success).toBe(false);
    }
  });

  it('should reject extra keys on thinking variants', () => {
    const cases = [
      { type: 'adaptive', budgetTokens: 1000 },
      { type: 'disabled', budgetTokens: 1000 },
      { type: 'enabled', extra: true },
    ];
    for (const thinking of cases) {
      const result = claudeCodeSettingsSchema.safeParse({ thinking });
      expect(result.success).toBe(false);
    }
  });

  it('should only accept plugins with type local (SDK SdkPluginConfig)', () => {
    expect(
      claudeCodeSettingsSchema.safeParse({ plugins: [{ type: 'local', path: './p' }] }).success
    ).toBe(true);
    // The SDK throws 'Unsupported plugin type' at query time for anything else.
    expect(
      claudeCodeSettingsSchema.safeParse({ plugins: [{ type: 'remote', path: './p' }] }).success
    ).toBe(false);
  });

  it('should accept systemPrompt as a string array (cache boundary form)', () => {
    const settings = {
      systemPrompt: ['Static instructions.', '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__', 'Dynamic.'],
    };
    expect(claudeCodeSettingsSchema.safeParse(settings).success).toBe(true);
  });

  it('should accept systemPrompt preset with excludeDynamicSections', () => {
    const settings = {
      systemPrompt: { type: 'preset', preset: 'claude_code', excludeDynamicSections: true },
    };
    expect(claudeCodeSettingsSchema.safeParse(settings).success).toBe(true);
  });

  it('should accept skills as an array or the literal all', () => {
    expect(claudeCodeSettingsSchema.safeParse({ skills: ['pdf', 'docx'] }).success).toBe(true);
    expect(claudeCodeSettingsSchema.safeParse({ skills: 'all' }).success).toBe(true);
  });

  it('should reject invalid skills values', () => {
    expect(claudeCodeSettingsSchema.safeParse({ skills: 'some' }).success).toBe(false);
    expect(claudeCodeSettingsSchema.safeParse({ skills: true }).success).toBe(false);
  });

  it('should accept settings as a path string or inline object', () => {
    expect(claudeCodeSettingsSchema.safeParse({ settings: '/path/to/settings.json' }).success).toBe(
      true
    );
    expect(
      claudeCodeSettingsSchema.safeParse({
        settings: { permissions: { allow: ['Bash(ls:*)'] } },
      }).success
    ).toBe(true);
  });

  it('should accept managedSettings as an object', () => {
    const settings = {
      managedSettings: { sandbox: { network: { allowManagedDomainsOnly: true } } },
    };
    expect(claudeCodeSettingsSchema.safeParse(settings).success).toBe(true);
  });

  it('should accept toolAliases as a record of strings', () => {
    expect(
      claudeCodeSettingsSchema.safeParse({ toolAliases: { Bash: 'mcp__workspace__bash' } }).success
    ).toBe(true);
    expect(claudeCodeSettingsSchema.safeParse({ toolAliases: { Bash: 1 } }).success).toBe(false);
  });

  it('should accept toolConfig with askUserQuestion previewFormat', () => {
    expect(
      claudeCodeSettingsSchema.safeParse({
        toolConfig: { askUserQuestion: { previewFormat: 'html' } },
      }).success
    ).toBe(true);
    expect(
      claudeCodeSettingsSchema.safeParse({
        toolConfig: { askUserQuestion: { previewFormat: 'plaintext' } },
      }).success
    ).toBe(false);
  });

  it('should accept planModeInstructions and title as strings', () => {
    expect(
      claudeCodeSettingsSchema.safeParse({ planModeInstructions: 'Research only.' }).success
    ).toBe(true);
    expect(claudeCodeSettingsSchema.safeParse({ title: 'My session' }).success).toBe(true);
    expect(claudeCodeSettingsSchema.safeParse({ title: 42 }).success).toBe(false);
  });

  it('should accept the new boolean passthrough options', () => {
    for (const key of ['forwardSubagentText', 'agentProgressSummaries', 'includeHookEvents']) {
      expect(claudeCodeSettingsSchema.safeParse({ [key]: true }).success).toBe(true);
      expect(claudeCodeSettingsSchema.safeParse({ [key]: 'yes' }).success).toBe(false);
    }
  });

  it('should accept taskBudget with a positive total', () => {
    expect(claudeCodeSettingsSchema.safeParse({ taskBudget: { total: 50000 } }).success).toBe(true);
    expect(claudeCodeSettingsSchema.safeParse({ taskBudget: { total: -1 } }).success).toBe(false);
    expect(
      claudeCodeSettingsSchema.safeParse({ taskBudget: { total: 1, extra: true } }).success
    ).toBe(false);
  });

  it('should accept sessionStore objects with append() and load()', () => {
    const sessionStore = { append: async () => undefined, load: async () => null };
    expect(claudeCodeSettingsSchema.safeParse({ sessionStore }).success).toBe(true);
    expect(claudeCodeSettingsSchema.safeParse({ sessionStore: {} }).success).toBe(false);
    expect(claudeCodeSettingsSchema.safeParse({ sessionStore: 'store' }).success).toBe(false);
  });

  it('should accept sessionStoreFlush and loadTimeoutMs', () => {
    expect(claudeCodeSettingsSchema.safeParse({ sessionStoreFlush: 'batched' }).success).toBe(true);
    expect(claudeCodeSettingsSchema.safeParse({ sessionStoreFlush: 'eager' }).success).toBe(true);
    expect(claudeCodeSettingsSchema.safeParse({ sessionStoreFlush: 'never' }).success).toBe(false);
    expect(claudeCodeSettingsSchema.safeParse({ loadTimeoutMs: 30000 }).success).toBe(true);
    expect(claudeCodeSettingsSchema.safeParse({ loadTimeoutMs: -1 }).success).toBe(false);
  });

  it('should accept promptSuggestions as a boolean', () => {
    expect(claudeCodeSettingsSchema.safeParse({ promptSuggestions: true }).success).toBe(true);
    expect(claudeCodeSettingsSchema.safeParse({ promptSuggestions: false }).success).toBe(true);
  });

  it('should reject promptSuggestions when not a boolean', () => {
    expect(claudeCodeSettingsSchema.safeParse({ promptSuggestions: 'yes' }).success).toBe(false);
  });

  it('should accept onPromptSuggestion as a function', () => {
    expect(claudeCodeSettingsSchema.safeParse({ onPromptSuggestion: () => {} }).success).toBe(true);
  });

  it('should reject onPromptSuggestion when not a function', () => {
    expect(claudeCodeSettingsSchema.safeParse({ onPromptSuggestion: 'callback' }).success).toBe(
      false
    );
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

  it('should accept sessionId as a UUID string', () => {
    const settings = { sessionId: '4ed1ad15-2d5e-4e0c-92cb-e4ae42049fb6' };
    const result = claudeCodeSettingsSchema.safeParse(settings);
    expect(result.success).toBe(true);
  });

  it('should reject sessionId values that are not UUIDs', () => {
    // The CLI rejects --session-id values that are not valid UUIDs.
    const result = claudeCodeSettingsSchema.safeParse({ sessionId: 'my-session-1' });
    expect(result.success).toBe(false);
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
    // 'fable' is documented as a valid alias by the SDK (AgentDefinition.model)
    expect(validateModelId('fable')).toBeUndefined();
  });

  it('should warn about unknown models', () => {
    const warning = validateModelId('gpt-4');
    expect(warning).toContain("Unknown model ID: 'gpt-4'");
    expect(warning).toContain('Known models are: opus, sonnet, haiku, fable');
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
    // Valid permission modes (mirrors the SDK 0.3.x PermissionMode union,
    // including 'auto' and 'dontAsk' added in 0.3.x)
    const validModes = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto'];
    validModes.forEach((mode) => {
      const result = validateSettings({ permissionMode: mode });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    // Invalid permission mode
    const invalidResult = validateSettings({ permissionMode: 'invalid' });
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.errors[0]).toContain('permissionMode');

    // 'delegate' was removed in SDK 0.3.x and the CLI rejects
    // --permission-mode delegate at argv parsing, so validation rejects it
    // too instead of letting every query fail at spawn time.
    const delegateResult = validateSettings({ permissionMode: 'delegate' });
    expect(delegateResult.valid).toBe(false);
    expect(delegateResult.errors[0]).toContain('permissionMode');
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

  it('should reject sessionStore combined with persistSession: false', () => {
    const sessionStore = { append: async () => undefined, load: async () => null };

    const conflict = validateSettings({ sessionStore, persistSession: false });
    expect(conflict.valid).toBe(false);
    expect(conflict.errors[0]).toContain('sessionStore cannot be combined with persistSession');

    // sessionStore alone (or with persistSession: true) is fine
    expect(validateSettings({ sessionStore }).valid).toBe(true);
    expect(validateSettings({ sessionStore, persistSession: true }).valid).toBe(true);
  });

  it('should reject sessionStore combined with enableFileCheckpointing: true', () => {
    const sessionStore = { append: async () => undefined, load: async () => null };

    const conflict = validateSettings({ sessionStore, enableFileCheckpointing: true });
    expect(conflict.valid).toBe(false);
    expect(conflict.errors[0]).toContain(
      'sessionStore cannot be combined with enableFileCheckpointing'
    );

    // enableFileCheckpointing without sessionStore (and vice versa) is fine
    expect(validateSettings({ enableFileCheckpointing: true }).valid).toBe(true);
    expect(validateSettings({ sessionStore, enableFileCheckpointing: false }).valid).toBe(true);
  });

  it('should reject continue: true with a sessionStore lacking listSessions()', () => {
    const sessionStore = { append: async () => undefined, load: async () => null };

    const conflict = validateSettings({ continue: true, sessionStore });
    expect(conflict.valid).toBe(false);
    expect(conflict.errors[0]).toContain('requires the store to implement listSessions()');

    // A store implementing listSessions() is fine
    const storeWithList = { ...sessionStore, listSessions: async () => [] };
    expect(validateSettings({ continue: true, sessionStore: storeWithList }).valid).toBe(true);

    // An explicit resume ID sidesteps the discovery requirement
    expect(validateSettings({ continue: true, sessionStore, resume: 'session-123' }).valid).toBe(
      true
    );
    expect(
      validateSettings({ continue: true, sessionStore, sdkOptions: { resume: 'session-123' } })
        .valid
    ).toBe(true);

    // A blank/whitespace resume id is treated as absent (the SDK ignores it),
    // so it does NOT sidestep the listSessions requirement.
    expect(validateSettings({ continue: true, sessionStore, resume: '' }).valid).toBe(false);
    expect(validateSettings({ continue: true, sessionStore, resume: '   ' }).valid).toBe(false);

    // continue without sessionStore (and vice versa) is fine
    expect(validateSettings({ continue: true }).valid).toBe(true);
    expect(validateSettings({ sessionStore }).valid).toBe(true);
  });

  it('should reject sandbox combined with a settings file path', () => {
    const conflict = validateSettings({
      sandbox: { enabled: true },
      settings: '/etc/claude/settings.json',
    });
    expect(conflict.valid).toBe(false);
    expect(conflict.errors[0]).toContain('sandbox cannot be combined with a settings file path');

    // Inline Settings objects (and inline JSON strings) are fine with sandbox
    expect(
      validateSettings({ sandbox: { enabled: true }, settings: { model: 'sonnet' } }).valid
    ).toBe(true);
    expect(
      validateSettings({ sandbox: { enabled: true }, settings: '{"model":"sonnet"}' }).valid
    ).toBe(true);

    // A settings file path without sandbox is fine
    expect(validateSettings({ settings: '/etc/claude/settings.json' }).valid).toBe(true);
  });

  it('should reject sessionId combined with continue/resume unless forkSession is set', () => {
    const sessionId = '4ed1ad15-2d5e-4e0c-92cb-e4ae42049fb6';

    const withContinue = validateSettings({ sessionId, continue: true });
    expect(withContinue.valid).toBe(false);
    expect(withContinue.errors[0]).toContain(
      'sessionId cannot be combined with continue or resume'
    );

    const withResume = validateSettings({ sessionId, resume: 'session-123' });
    expect(withResume.valid).toBe(false);
    expect(withResume.errors[0]).toContain('sessionId cannot be combined with continue or resume');

    // forkSession: true makes the combination valid (sessionId names the fork's ID)
    expect(validateSettings({ sessionId, resume: 'session-123', forkSession: true }).valid).toBe(
      true
    );
    expect(
      validateSettings({ sessionId, resume: 'session-123', sdkOptions: { forkSession: true } })
        .valid
    ).toBe(true);

    // continue/resume via the sdkOptions escape hatch hit the same CLI
    // constraint and are rejected too
    const withSdkContinue = validateSettings({ sessionId, sdkOptions: { continue: true } });
    expect(withSdkContinue.valid).toBe(false);
    expect(withSdkContinue.errors[0]).toContain(
      'sessionId cannot be combined with continue or resume'
    );
    const withSdkResume = validateSettings({ sessionId, sdkOptions: { resume: 'session-123' } });
    expect(withSdkResume.valid).toBe(false);

    // ...unless forkSession accompanies them
    expect(
      validateSettings({ sessionId, sdkOptions: { continue: true, forkSession: true } }).valid
    ).toBe(true);

    // sessionId alone is fine
    expect(validateSettings({ sessionId }).valid).toBe(true);
  });

  it('should accept agents with full model ID strings (SDK 0.3.x AgentDefinition)', () => {
    const result = validateSettings({
      agents: {
        researcher: {
          description: 'Research assistant',
          prompt: 'You research things.',
          model: 'claude-sonnet-4-6',
          effort: 'high',
          background: true,
          initialPrompt: 'Start by reading the README.',
        },
      },
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should warn (but allow) agent model values that look like typo'd aliases", () => {
    const result = validateSettings({
      agents: {
        researcher: {
          description: 'Research assistant',
          prompt: 'You research things.',
          model: 'sonet',
        },
      },
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(
      result.warnings.some(
        (w) => w.includes("Unknown model alias 'sonet'") && w.includes("agent 'researcher'")
      )
    ).toBe(true);
  });

  it('should not warn for known agent model aliases or full model IDs', () => {
    for (const model of ['sonnet', 'opus', 'haiku', 'fable', 'inherit', 'claude-sonnet-4-5']) {
      const result = validateSettings({
        agents: {
          worker: {
            description: 'Worker agent',
            prompt: 'You work.',
            model,
          },
        },
      });
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes('Unknown model alias'))).toBe(false);
    }
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

    it('should not warn when settingSources arrives via the sdkOptions escape hatch', () => {
      const settings = {
        allowedTools: ['Skill', 'Read'],
        sdkOptions: {
          settingSources: ['user', 'project'] as const,
        },
      };
      const result = validateSettings(settings);

      expect(result.valid).toBe(true);
      const skillWarnings = result.warnings.filter((w) =>
        w.includes("allowedTools includes 'Skill'")
      );
      expect(skillWarnings).toHaveLength(0);
    });

    it('should warn when Skill arrives via sdkOptions.allowedTools but settingSources is not set', () => {
      const settings = {
        sdkOptions: {
          allowedTools: ['Skill', 'Read'],
        },
      };
      const result = validateSettings(settings);

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes("allowedTools includes 'Skill'"))).toBe(true);
      expect(result.warnings.some((w) => w.includes('settingSources is not set'))).toBe(true);
    });

    it('should not warn when both Skill and settingSources arrive via sdkOptions', () => {
      const settings = {
        sdkOptions: {
          allowedTools: ['Skill', 'Read'],
          settingSources: ['user', 'project'] as const,
        },
      };
      const result = validateSettings(settings);

      expect(result.valid).toBe(true);
      const skillWarnings = result.warnings.filter((w) =>
        w.includes("allowedTools includes 'Skill'")
      );
      expect(skillWarnings).toHaveLength(0);
    });
  });

  describe('User dialog settings', () => {
    it('should accept onUserDialog and supportedDialogKinds together', () => {
      const result = validateSettings({
        onUserDialog: async () => ({ behavior: 'cancelled' }),
        supportedDialogKinds: ['refusal_fallback_prompt'],
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings.filter((w) => w.includes('supportedDialogKinds'))).toHaveLength(0);
    });

    it('should reject non-function onUserDialog', () => {
      const result = validateSettings({ onUserDialog: 'not-a-function' });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('onUserDialog must be a function');
    });

    it('should reject supportedDialogKinds set without onUserDialog (SDK throws)', () => {
      const result = validateSettings({
        supportedDialogKinds: ['refusal_fallback_prompt'],
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('supportedDialogKinds is set without onUserDialog');
    });

    it('should not warn for an empty supportedDialogKinds array without onUserDialog', () => {
      // The SDK only throws for a NON-empty list without the callback.
      const result = validateSettings({
        supportedDialogKinds: [],
      });

      expect(result.valid).toBe(true);
      expect(result.warnings.filter((w) => w.includes('supportedDialogKinds'))).toHaveLength(0);
    });

    it('should accept supportedDialogKinds when onUserDialog is supplied via sdkOptions', () => {
      // sdkOptions is merged after the settings block, so this combination is
      // valid at runtime and must not be rejected.
      const result = validateSettings({
        supportedDialogKinds: ['refusal_fallback_prompt'],
        sdkOptions: {
          onUserDialog: async () => ({ behavior: 'cancelled' }),
        },
      });

      expect(result.valid).toBe(true);
      expect(result.warnings.filter((w) => w.includes('supportedDialogKinds'))).toHaveLength(0);
    });

    it('applies cross-option SDK constraints to the merged sdkOptions overlay', () => {
      const sessionStore = { append: async () => undefined, load: async () => null };

      // sessionStore arriving via sdkOptions still conflicts with persistSession: false
      const storeViaSdkOptions = validateSettings({
        persistSession: false,
        sdkOptions: { sessionStore },
      });
      expect(storeViaSdkOptions.valid).toBe(false);
      expect(storeViaSdkOptions.errors[0]).toContain(
        'sessionStore cannot be combined with persistSession'
      );

      // continue arriving via sdkOptions still requires listSessions() on the store
      const continueViaSdkOptions = validateSettings({
        sessionStore,
        sdkOptions: { continue: true },
      });
      expect(continueViaSdkOptions.valid).toBe(false);
      expect(continueViaSdkOptions.errors[0]).toContain('listSessions()');

      // enableFileCheckpointing via sdkOptions conflicts with first-class sessionStore
      const checkpointViaSdkOptions = validateSettings({
        sessionStore,
        sdkOptions: { enableFileCheckpointing: true },
      });
      expect(checkpointViaSdkOptions.valid).toBe(false);
      expect(checkpointViaSdkOptions.errors[0]).toContain('enableFileCheckpointing');

      // sandbox via sdkOptions conflicts with a first-class settings file path
      const sandboxViaSdkOptions = validateSettings({
        settings: '/etc/claude/settings.json',
        sdkOptions: { sandbox: { enabled: true } },
      });
      expect(sandboxViaSdkOptions.valid).toBe(false);
      expect(sandboxViaSdkOptions.errors[0]).toContain('sandbox cannot be combined');

      // an sdkOptions override can also RESOLVE a first-class conflict
      const resolvedConflict = validateSettings({
        sessionStore,
        persistSession: false,
        sdkOptions: { persistSession: true },
      });
      expect(resolvedConflict.valid).toBe(true);

      // supportedDialogKinds via sdkOptions without a handler is rejected too
      const kindsViaSdkOptions = validateSettings({
        sdkOptions: { supportedDialogKinds: ['refusal_fallback_prompt'] },
      });
      expect(kindsViaSdkOptions.valid).toBe(false);
      expect(kindsViaSdkOptions.errors[0]).toContain('supportedDialogKinds');
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
