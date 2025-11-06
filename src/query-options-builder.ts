import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeCodeSettings, Logger } from './types.js';

export class QueryOptionsBuilder {
  private readonly settings: ClaudeCodeSettings;
  private readonly model: string;
  private readonly abortController: AbortController;
  private readonly logger: Logger;

  constructor(
    settings: ClaudeCodeSettings,
    model: string,
    abortController: AbortController,
    logger: Logger
  ) {
    this.settings = settings;
    this.model = model;
    this.abortController = abortController;
    this.logger = logger;
  }

  build(sessionId?: string): Options {
    const opts: Partial<Options> & Record<string, unknown> = {
      model: this.model,
      abortController: this.abortController,
      resume: this.settings.resume ?? sessionId,
      pathToClaudeCodeExecutable: this.settings.pathToClaudeCodeExecutable,
      maxTurns: this.settings.maxTurns,
      maxThinkingTokens: this.settings.maxThinkingTokens,
      cwd: this.settings.cwd,
      executable: this.settings.executable,
      executableArgs: this.settings.executableArgs,
      permissionMode: this.settings.permissionMode,
      permissionPromptToolName: this.settings.permissionPromptToolName,
      continue: this.settings.continue,
      allowedTools: this.settings.allowedTools,
      disallowedTools: this.settings.disallowedTools,
      mcpServers: this.settings.mcpServers,
      canUseTool: this.settings.canUseTool,
    };

    this.applySystemPromptOptions(opts);
    this.applyAgentSDKOptions(opts);
    this.applyEnvironmentOptions(opts);

    return opts as Options;
  }

  private applySystemPromptOptions(opts: Partial<Options> & Record<string, unknown>): void {
    if (this.settings.systemPrompt !== undefined) {
      opts.systemPrompt = this.settings.systemPrompt;
    } else if (this.settings.customSystemPrompt !== undefined) {
      this.logger.warn(
        "[claude-code] 'customSystemPrompt' is deprecated. Use 'systemPrompt' instead."
      );
      opts.systemPrompt = this.settings.customSystemPrompt;
    } else if (this.settings.appendSystemPrompt !== undefined) {
      this.logger.warn(
        "[claude-code] 'appendSystemPrompt' is deprecated. Use 'systemPrompt: { type: 'preset', preset: 'claude_code', append: <text> }' instead."
      );
      opts.systemPrompt = {
        type: 'preset',
        preset: 'claude_code',
        append: this.settings.appendSystemPrompt,
      } as const;
    }
  }

  private applyAgentSDKOptions(opts: Partial<Options> & Record<string, unknown>): void {
    if (this.settings.settingSources !== undefined) {
      opts.settingSources = this.settings.settingSources;
    }
    if (this.settings.additionalDirectories !== undefined) {
      opts.additionalDirectories = this.settings.additionalDirectories;
    }
    if (this.settings.agents !== undefined) {
      opts.agents = this.settings.agents;
    }
    if (this.settings.includePartialMessages !== undefined) {
      opts.includePartialMessages = this.settings.includePartialMessages;
    }
    if (this.settings.fallbackModel !== undefined) {
      opts.fallbackModel = this.settings.fallbackModel;
    }
    if (this.settings.forkSession !== undefined) {
      opts.forkSession = this.settings.forkSession;
    }
    if (this.settings.stderr !== undefined) {
      opts.stderr = this.settings.stderr;
    }
    if (this.settings.strictMcpConfig !== undefined) {
      opts.strictMcpConfig = this.settings.strictMcpConfig;
    }
    if (this.settings.extraArgs !== undefined) {
      opts.extraArgs = this.settings.extraArgs;
    }
    if (this.settings.hooks !== undefined) {
      opts.hooks = this.settings.hooks;
    }
  }

  private applyEnvironmentOptions(opts: Partial<Options> & Record<string, unknown>): void {
    if (this.settings.env !== undefined) {
      opts.env = { ...process.env, ...this.settings.env };
    }
  }
}
