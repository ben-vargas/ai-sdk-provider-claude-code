import { describe, it, expect } from 'vitest';
import { createClaudeCode } from './claude-code-provider.js';
import { ClaudeCodeLanguageModel } from './claude-code-language-model.js';

describe('createClaudeCode', () => {
  it('should create a provider with default settings', () => {
    const provider = createClaudeCode();
    expect(provider).toBeDefined();
    expect(typeof provider).toBe('function');
  });

  it('should create a provider with custom settings', () => {
    const customSettings = {
      pathToClaudeCodeExecutable: '/custom/path/claude',
      customSystemPrompt: 'Custom prompt',
      maxTurns: 10,
    };

    const provider = createClaudeCode({ defaultSettings: customSettings });
    expect(provider).toBeDefined();
  });

  it('should return a language model when called with opus', () => {
    const provider = createClaudeCode();
    const model = provider('opus');

    expect(model).toBeInstanceOf(ClaudeCodeLanguageModel);
    expect(model.modelId).toBe('opus');
  });

  it('should return a language model when called with sonnet', () => {
    const provider = createClaudeCode();
    const model = provider('sonnet');

    expect(model).toBeInstanceOf(ClaudeCodeLanguageModel);
    expect(model.modelId).toBe('sonnet');
  });

  it('should allow custom model IDs', () => {
    const provider = createClaudeCode();
    const model = provider('custom-model-id');

    expect(model).toBeInstanceOf(ClaudeCodeLanguageModel);
    expect(model.modelId).toBe('custom-model-id');
  });

  it('should merge provider settings with model settings', () => {
    const providerSettings = {
      pathToClaudeCodeExecutable: '/provider/path',
      maxTurns: 5,
    };

    const modelSettings = {
      maxTurns: 10,
      customSystemPrompt: 'Model prompt',
    };

    const provider = createClaudeCode({ defaultSettings: providerSettings });
    const model = provider('opus', modelSettings);

    expect(model).toBeInstanceOf(ClaudeCodeLanguageModel);
    // Model settings should override provider settings
    expect((model as ClaudeCodeLanguageModel).settings.maxTurns).toBe(10);
    expect((model as ClaudeCodeLanguageModel).settings.customSystemPrompt).toBe(
      'Model prompt'
    );
    expect(
      (model as ClaudeCodeLanguageModel).settings.pathToClaudeCodeExecutable
    ).toBe('/provider/path');
  });

  it('should create model with custom settings', () => {
    const provider = createClaudeCode();
    const model = provider('sonnet', { resume: 'test-session-123' });

    expect(model).toBeInstanceOf(ClaudeCodeLanguageModel);
    expect((model as ClaudeCodeLanguageModel).settings.resume).toBe(
      'test-session-123'
    );
  });

  it('should work with destructured usage', () => {
    const { claudeCode } = { claudeCode: createClaudeCode() };
    const model = claudeCode('opus');

    expect(model).toBeInstanceOf(ClaudeCodeLanguageModel);
    expect(model.modelId).toBe('opus');
  });
});

describe('claudeCode export', () => {
  it('should export a default provider instance', async () => {
    const { claudeCode } = await import('./claude-code-provider.js');

    expect(claudeCode).toBeDefined();
    expect(typeof claudeCode).toBe('function');

    const model = claudeCode('sonnet');
    expect(model).toBeInstanceOf(ClaudeCodeLanguageModel);
  });
});
