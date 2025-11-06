import type { LanguageModelV2, LanguageModelV2CallWarning, JSONValue } from '@ai-sdk/provider';
import { validatePrompt } from './validation.js';

type GenerateOptions = Parameters<LanguageModelV2['doGenerate']>[0];
type StreamOptions = Parameters<LanguageModelV2['doStream']>[0];

export class WarningGenerator {
  private readonly modelValidationWarning?: string;
  private readonly settingsValidationWarnings: string[];

  constructor(modelValidationWarning?: string, settingsValidationWarnings: string[] = []) {
    this.modelValidationWarning = modelValidationWarning;
    this.settingsValidationWarnings = settingsValidationWarnings;
  }

  generateAllWarnings(
    options: GenerateOptions | StreamOptions,
    prompt: string
  ): LanguageModelV2CallWarning[] {
    const warnings: LanguageModelV2CallWarning[] = [];

    this.addUnsupportedParameterWarnings(options, warnings);
    this.addModelValidationWarning(warnings);
    this.addSettingsValidationWarnings(warnings);
    this.addPromptValidationWarning(prompt, warnings);

    return warnings;
  }

  serializeWarningsForMetadata(warnings: LanguageModelV2CallWarning[]): JSONValue {
    const result = warnings.map((w) => {
      const base: Record<string, string> = { type: w.type };

      if ('message' in w) {
        const m = (w as { message?: unknown }).message;
        if (m !== undefined) base.message = String(m);
      }

      if (w.type === 'unsupported-setting') {
        const setting = (w as { setting: unknown }).setting;
        if (setting !== undefined) base.setting = String(setting);
        if ('details' in w) {
          const d = (w as { details?: unknown }).details;
          if (d !== undefined) base.details = String(d);
        }
      }

      return base;
    });

    return result as unknown as JSONValue;
  }

  private addUnsupportedParameterWarnings(
    options: GenerateOptions | StreamOptions,
    warnings: LanguageModelV2CallWarning[]
  ): void {
    const unsupportedParams = this.collectUnsupportedParams(options);

    for (const param of unsupportedParams) {
      warnings.push({
        type: 'unsupported-setting',
        setting: param as
          | 'temperature'
          | 'maxTokens'
          | 'topP'
          | 'topK'
          | 'presencePenalty'
          | 'frequencyPenalty'
          | 'stopSequences'
          | 'seed',
        details: `Claude Code SDK does not support the ${param} parameter. It will be ignored.`,
      });
    }
  }

  private collectUnsupportedParams(options: GenerateOptions | StreamOptions): string[] {
    const unsupportedParams: string[] = [];

    if (options.temperature !== undefined) unsupportedParams.push('temperature');
    if (options.topP !== undefined) unsupportedParams.push('topP');
    if (options.topK !== undefined) unsupportedParams.push('topK');
    if (options.presencePenalty !== undefined) unsupportedParams.push('presencePenalty');
    if (options.frequencyPenalty !== undefined) unsupportedParams.push('frequencyPenalty');
    if (options.stopSequences !== undefined && options.stopSequences.length > 0)
      unsupportedParams.push('stopSequences');
    if (options.seed !== undefined) unsupportedParams.push('seed');

    return unsupportedParams;
  }

  private addModelValidationWarning(warnings: LanguageModelV2CallWarning[]): void {
    if (this.modelValidationWarning) {
      warnings.push({
        type: 'other',
        message: this.modelValidationWarning,
      });
    }
  }

  private addSettingsValidationWarnings(warnings: LanguageModelV2CallWarning[]): void {
    this.settingsValidationWarnings.forEach((warning) => {
      warnings.push({
        type: 'other',
        message: warning,
      });
    });
  }

  private addPromptValidationWarning(
    prompt: string,
    warnings: LanguageModelV2CallWarning[]
  ): void {
    const promptWarning = validatePrompt(prompt);
    if (promptWarning) {
      warnings.push({
        type: 'other',
        message: promptWarning,
      });
    }
  }
}
