import type { LanguageModelV2, ProviderV2 } from '@ai-sdk/provider';
import { NoSuchModelError } from '@ai-sdk/provider';
import {
  ClaudeCodeLanguageModel,
  type ClaudeCodeModelId,
} from './claude-code-language-model.js';
import type { ClaudeCodeSettings } from './types.js';
import { validateSettings } from './validation.js';
import { getLogger } from './logger.js';

/**
 * Claude Code provider interface that extends the AI SDK's ProviderV1.
 * Provides methods to create language models for interacting with Claude via the CLI.
 *
 * @example
 * ```typescript
 * import { claudeCode } from 'ai-sdk-provider-claude-code';
 *
 * // Create a model instance
 * const model = claudeCode('opus');
 *
 * // Or use the explicit methods
 * const chatModel = claudeCode.chat('sonnet');
 * const languageModel = claudeCode.languageModel('opus', { maxTurns: 10 });
 * ```
 */
export interface ClaudeCodeProvider extends ProviderV2 {
  /**
   * Creates a language model instance for the specified model ID.
   * This is a shorthand for calling `languageModel()`.
   *
   * @param modelId - The Claude model to use ('opus' or 'sonnet')
   * @param settings - Optional settings to configure the model
   * @returns A language model instance
   */
  (modelId: ClaudeCodeModelId, settings?: ClaudeCodeSettings): LanguageModelV2;

  /**
   * Creates a language model instance for text generation.
   *
   * @param modelId - The Claude model to use ('opus' or 'sonnet')
   * @param settings - Optional settings to configure the model
   * @returns A language model instance
   */
  languageModel(
    modelId: ClaudeCodeModelId,
    settings?: ClaudeCodeSettings
  ): LanguageModelV2;

  /**
   * Alias for `languageModel()` to maintain compatibility with AI SDK patterns.
   *
   * @param modelId - The Claude model to use ('opus' or 'sonnet')
   * @param settings - Optional settings to configure the model
   * @returns A language model instance
   */
  chat(
    modelId: ClaudeCodeModelId,
    settings?: ClaudeCodeSettings
  ): LanguageModelV2;

  imageModel(modelId: string): never;
}

/**
 * Configuration options for creating a Claude Code provider instance.
 * These settings will be applied as defaults to all models created by the provider.
 *
 * @example
 * ```typescript
 * const provider = createClaudeCode({
 *   defaultSettings: {
 *     maxTurns: 5,
 *     cwd: '/path/to/project'
 *   }
 * });
 * ```
 */
export interface ClaudeCodeProviderSettings {
  /**
   * Default settings to use for all models created by this provider.
   * Individual model settings will override these defaults.
   */
  defaultSettings?: ClaudeCodeSettings;
}

/**
 * Creates a Claude Code provider instance with the specified configuration.
 * The provider can be used to create language models for interacting with Claude 4 models.
 *
 * @param options - Provider configuration options
 * @returns Claude Code provider instance
 *
 * @example
 * ```typescript
 * const provider = createClaudeCode({
 *   defaultSettings: {
 *     permissionMode: 'bypassPermissions',
 *     maxTurns: 10
 *   }
 * });
 *
 * const model = provider('opus');
 * ```
 */
export function createClaudeCode(
  options: ClaudeCodeProviderSettings = {}
): ClaudeCodeProvider {
  // Get logger from default settings if provided
  const logger = getLogger(options.defaultSettings?.logger);

  // Validate default settings if provided
  if (options.defaultSettings) {
    const validation = validateSettings(options.defaultSettings);
    if (!validation.valid) {
      throw new Error(
        `Invalid default settings: ${validation.errors.join(', ')}`
      );
    }
    if (validation.warnings.length > 0) {
      validation.warnings.forEach((warning) =>
        logger.warn(`Claude Code Provider: ${warning}`)
      );
    }
  }

  const createModel = (
    modelId: ClaudeCodeModelId,
    settings: ClaudeCodeSettings = {}
  ): LanguageModelV2 => {
    const mergedSettings = {
      ...options.defaultSettings,
      ...settings,
    };

    // Validate merged settings
    const validation = validateSettings(mergedSettings);
    if (!validation.valid) {
      throw new Error(`Invalid settings: ${validation.errors.join(', ')}`);
    }

    return new ClaudeCodeLanguageModel({
      id: modelId,
      settings: mergedSettings,
      settingsValidationWarnings: validation.warnings,
    });
  };

  const provider = function (
    modelId: ClaudeCodeModelId,
    settings?: ClaudeCodeSettings
  ) {
    if (new.target) {
      throw new Error(
        'The Claude Code model function cannot be called with the new keyword.'
      );
    }

    return createModel(modelId, settings);
  };

  provider.languageModel = createModel;
  provider.chat = createModel; // Alias for languageModel

  // Add textEmbeddingModel method that throws NoSuchModelError
  provider.textEmbeddingModel = (modelId: string) => {
    throw new NoSuchModelError({
      modelId,
      modelType: 'textEmbeddingModel',
    });
  };

  provider.imageModel = (modelId: string) => {
    throw new NoSuchModelError({
      modelId,
      modelType: 'imageModel',
    });
  };

  return provider as ClaudeCodeProvider;
}

/**
 * Default Claude Code provider instance.
 * Pre-configured provider for quick usage without custom settings.
 *
 * @example
 * ```typescript
 * import { claudeCode } from 'ai-sdk-provider-claude-code';
 * import { generateText } from 'ai';
 *
 * const { text } = await generateText({
 *   model: claudeCode('sonnet'),
 *   prompt: 'Hello, Claude!'
 * });
 * ```
 */
export const claudeCode = createClaudeCode();
