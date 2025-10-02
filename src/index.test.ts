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
  });

  it('should export correct modules', async () => {
    const indexExports = await import('./index.js');
    const providerExports = await import('./claude-code-provider.js');
    const errorExports = await import('./errors.js');

    // Check that exported functions are the same references
    expect(indexExports.createClaudeCode).toBe(
      providerExports.createClaudeCode
    );
    expect(indexExports.claudeCode).toBe(providerExports.claudeCode);
    expect(indexExports.isAuthenticationError).toBe(
      errorExports.isAuthenticationError
    );
    expect(indexExports.isTimeoutError).toBe(errorExports.isTimeoutError);
  });
});
