import { describe, it, expect } from 'vitest';

describe('index exports', () => {
  it('should export all expected functions and types', async () => {
    const exports = await import('./index.js');

    // Provider exports
    expect(exports.createClaudeCode).toBeDefined();
    expect(typeof exports.createClaudeCode).toBe('function');
    expect(exports.claudeCode).toBeDefined();
    expect(typeof exports.claudeCode).toBe('function');

    // Language model exports
    expect(exports.ClaudeCodeLanguageModel).toBeDefined();
    expect(typeof exports.ClaudeCodeLanguageModel).toBe('function');

    // Error handling exports
    expect(exports.isAuthenticationError).toBeDefined();
    expect(typeof exports.isAuthenticationError).toBe('function');
    expect(exports.isTimeoutError).toBeDefined();
    expect(typeof exports.isTimeoutError).toBe('function');
    expect(exports.getErrorMetadata).toBeDefined();
    expect(typeof exports.getErrorMetadata).toBe('function');
    expect(exports.createAPICallError).toBeDefined();
    expect(typeof exports.createAPICallError).toBe('function');
    expect(exports.createAuthenticationError).toBeDefined();
    expect(typeof exports.createAuthenticationError).toBe('function');
    expect(exports.createTimeoutError).toBeDefined();
    expect(typeof exports.createTimeoutError).toBe('function');

    // SDK passthroughs
    expect(exports.createSdkMcpServer).toBeDefined();
    expect(typeof exports.createSdkMcpServer).toBe('function');
    expect(exports.tool).toBeDefined();
    expect(typeof exports.tool).toBe('function');
    expect(exports.SYSTEM_PROMPT_DYNAMIC_BOUNDARY).toBeDefined();
    expect(typeof exports.SYSTEM_PROMPT_DYNAMIC_BOUNDARY).toBe('string');
    expect(exports.InMemorySessionStore).toBeDefined();
    expect(typeof exports.InMemorySessionStore).toBe('function');
    expect(exports.HOOK_EVENTS).toBeDefined();
    expect(Array.isArray(exports.HOOK_EVENTS)).toBe(true);
    expect(exports.HOOK_EVENTS).toContain('PreToolUse');
    expect(exports.AbortError).toBeDefined();
    expect(typeof exports.AbortError).toBe('function');

    // Session lifecycle helpers (SDK passthroughs)
    expect(exports.listSessions).toBeDefined();
    expect(typeof exports.listSessions).toBe('function');
    expect(exports.getSessionMessages).toBeDefined();
    expect(typeof exports.getSessionMessages).toBe('function');
    expect(exports.forkSession).toBeDefined();
    expect(typeof exports.forkSession).toBe('function');
    expect(exports.getSessionInfo).toBeDefined();
    expect(typeof exports.getSessionInfo).toBe('function');
    expect(exports.deleteSession).toBeDefined();
    expect(typeof exports.deleteSession).toBe('function');
    expect(exports.renameSession).toBeDefined();
    expect(typeof exports.renameSession).toBe('function');
    expect(exports.tagSession).toBeDefined();
    expect(typeof exports.tagSession).toBe('function');
    expect(exports.listSubagents).toBeDefined();
    expect(typeof exports.listSubagents).toBe('function');
    expect(exports.getSubagentMessages).toBeDefined();
    expect(typeof exports.getSubagentMessages).toBe('function');
    expect(exports.foldSessionSummary).toBeDefined();
    expect(typeof exports.foldSessionSummary).toBe('function');
    expect(exports.importSessionToStore).toBeDefined();
    expect(typeof exports.importSessionToStore).toBe('function');

    // Warm-start helper (SDK passthrough)
    expect(exports.startup).toBeDefined();
    expect(typeof exports.startup).toBe('function');
  });

  it('should export correct modules', async () => {
    const indexExports = await import('./index.js');
    const providerExports = await import('./claude-code-provider.js');
    const errorExports = await import('./errors.js');

    // Check that exported functions are the same references
    expect(indexExports.createClaudeCode).toBe(providerExports.createClaudeCode);
    expect(indexExports.claudeCode).toBe(providerExports.claudeCode);
    expect(indexExports.isAuthenticationError).toBe(errorExports.isAuthenticationError);
    expect(indexExports.isTimeoutError).toBe(errorExports.isTimeoutError);
  });
});
