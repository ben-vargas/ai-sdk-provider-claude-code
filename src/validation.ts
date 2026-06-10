import { z } from 'zod';
import { existsSync } from 'fs';

/**
 * Validation schemas and utilities for Claude Code provider inputs.
 * Uses Zod for type-safe validation following AI SDK patterns.
 */

// Helper for Zod v3/v4 compatibility
// Use a simple z.any() for functions to work with both versions
const loggerFunctionSchema = z.object({
  debug: z.any().refine((val) => typeof val === 'function', {
    message: 'debug must be a function',
  }),
  info: z.any().refine((val) => typeof val === 'function', {
    message: 'info must be a function',
  }),
  warn: z.any().refine((val) => typeof val === 'function', {
    message: 'warn must be a function',
  }),
  error: z.any().refine((val) => typeof val === 'function', {
    message: 'error must be a function',
  }),
});

/**
 * Schema for validating Claude Code settings.
 * Ensures all settings are within acceptable ranges and formats.
 */
export const claudeCodeSettingsSchema = z
  .object({
    pathToClaudeCodeExecutable: z.string().optional(),
    customSystemPrompt: z.string().optional(),
    appendSystemPrompt: z.string().optional(),
    systemPrompt: z
      .union([
        z.string(),
        z.array(z.string()),
        z.object({
          type: z.literal('preset'),
          preset: z.literal('claude_code'),
          append: z.string().optional(),
          excludeDynamicSections: z.boolean().optional(),
        }),
      ])
      .optional(),
    maxTurns: z.number().int().min(1).max(100).optional(),
    maxThinkingTokens: z.number().int().positive().max(100000).optional(),
    thinking: z
      .union([
        z.object({ type: z.literal('adaptive') }).strict(),
        z
          .object({
            type: z.literal('enabled'),
            budgetTokens: z.number().int().positive().optional(),
          })
          .strict(),
        z.object({ type: z.literal('disabled') }).strict(),
      ])
      .optional(),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
    promptSuggestions: z.boolean().optional(),
    cwd: z
      .string()
      .refine(
        (val) => {
          // Skip directory validation in non-Node environments
          if (typeof process === 'undefined' || !process.versions?.node) {
            return true;
          }
          return !val || existsSync(val);
        },
        { message: 'Working directory must exist' }
      )
      .optional(),
    executable: z.enum(['bun', 'deno', 'node']).optional(),
    executableArgs: z.array(z.string()).optional(),
    // 'auto' was added in SDK 0.3.x; 'delegate' is kept for runtime
    // backward compatibility even though SDK 0.3.x dropped it from the
    // PermissionMode type.
    permissionMode: z
      .enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'delegate', 'dontAsk', 'auto'])
      .optional(),
    permissionPromptToolName: z.string().optional(),
    continue: z.boolean().optional(),
    resume: z.string().optional(),
    sessionId: z.string().optional(),
    allowedTools: z.array(z.string()).optional(),
    disallowedTools: z.array(z.string()).optional(),
    betas: z.array(z.string()).optional(),
    allowDangerouslySkipPermissions: z.boolean().optional(),
    enableFileCheckpointing: z.boolean().optional(),
    maxBudgetUsd: z.number().min(0).optional(),
    plugins: z
      .array(
        z
          .object({
            type: z.string(),
            path: z.string(),
          })
          .passthrough()
      )
      .optional(),
    resumeSessionAt: z.string().optional(),
    sandbox: z
      .any()
      .refine((val) => val === undefined || typeof val === 'object', {
        message: 'sandbox must be an object',
      })
      .optional(),
    tools: z
      .union([
        z.array(z.string()),
        z.object({
          type: z.literal('preset'),
          preset: z.literal('claude_code'),
        }),
      ])
      .optional(),
    skills: z.union([z.array(z.string()), z.literal('all')]).optional(),
    settings: z
      .union([
        z.string(),
        z.record(z.string(), z.any()), // inline Settings object
      ])
      .optional(),
    managedSettings: z.record(z.string(), z.any()).optional(),
    toolAliases: z.record(z.string(), z.string()).optional(),
    toolConfig: z
      .object({
        askUserQuestion: z
          .object({
            previewFormat: z.enum(['markdown', 'html']).optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    planModeInstructions: z.string().optional(),
    title: z.string().optional(),
    forwardSubagentText: z.boolean().optional(),
    agentProgressSummaries: z.boolean().optional(),
    includeHookEvents: z.boolean().optional(),
    taskBudget: z.object({ total: z.number().positive() }).strict().optional(),
    sessionStore: z
      .any()
      .refine(
        (val) =>
          val === undefined ||
          (typeof val === 'object' &&
            val !== null &&
            typeof (val as { append?: unknown }).append === 'function' &&
            typeof (val as { load?: unknown }).load === 'function'),
        { message: 'sessionStore must be an object with append() and load() functions' }
      )
      .optional(),
    sessionStoreFlush: z.enum(['batched', 'eager']).optional(),
    loadTimeoutMs: z.number().int().positive().optional(),
    settingSources: z.array(z.enum(['user', 'project', 'local'])).optional(),
    streamingInput: z.enum(['auto', 'always', 'off']).optional(),
    // Hooks and tool-permission callback (permissive validation of shapes)
    canUseTool: z
      .any()
      .refine((v) => v === undefined || typeof v === 'function', {
        message: 'canUseTool must be a function',
      })
      .optional(),
    onUserDialog: z
      .any()
      .refine((v) => v === undefined || typeof v === 'function', {
        message: 'onUserDialog must be a function',
      })
      .optional(),
    supportedDialogKinds: z.array(z.string()).optional(),
    hooks: z
      .record(
        z.string(),
        z.array(
          z.object({
            matcher: z.string().optional(),
            hooks: z.array(z.any()).nonempty(),
          })
        )
      )
      .optional(),
    mcpServers: z
      .record(
        z.string(),
        z.union([
          // McpStdioServerConfig
          z.object({
            type: z.literal('stdio').optional(),
            command: z.string(),
            args: z.array(z.string()).optional(),
            env: z.record(z.string(), z.string()).optional(),
          }),
          // McpSSEServerConfig
          z.object({
            type: z.literal('sse'),
            url: z.string(),
            headers: z.record(z.string(), z.string()).optional(),
          }),
          // McpHttpServerConfig
          z.object({
            type: z.literal('http'),
            url: z.string(),
            headers: z.record(z.string(), z.string()).optional(),
          }),
          // McpSdkServerConfig (in-process custom tools)
          z.object({
            type: z.literal('sdk'),
            name: z.string(),
            instance: z.any(),
          }),
        ])
      )
      .optional(),
    verbose: z.boolean().optional(),
    debug: z.boolean().optional(),
    debugFile: z.string().optional(),
    logger: z.union([z.literal(false), loggerFunctionSchema]).optional(),
    env: z.record(z.string(), z.string().optional()).optional(),
    additionalDirectories: z.array(z.string()).optional(),
    agents: z
      .record(
        z.string(),
        z
          .object({
            description: z.string(),
            tools: z.array(z.string()).optional(),
            disallowedTools: z.array(z.string()).optional(),
            prompt: z.string(),
            // SDK 0.3.x AgentDefinition accepts any model alias or full model ID
            model: z.string().optional(),
            mcpServers: z
              .array(
                z.union([
                  z.string(),
                  z.record(z.string(), z.any()), // McpServerConfigForProcessTransport
                ])
              )
              .optional(),
            criticalSystemReminder_EXPERIMENTAL: z.string().optional(),
          })
          .passthrough()
      )
      .optional(),
    includePartialMessages: z.boolean().optional(),
    fallbackModel: z.string().optional(),
    forkSession: z.boolean().optional(),
    stderr: z
      .any()
      .refine((val) => val === undefined || typeof val === 'function', {
        message: 'stderr must be a function',
      })
      .optional(),
    strictMcpConfig: z.boolean().optional(),
    extraArgs: z.record(z.string(), z.union([z.string(), z.null()])).optional(),
    persistSession: z.boolean().optional(),
    spawnClaudeCodeProcess: z
      .any()
      .refine((val) => val === undefined || typeof val === 'function', {
        message: 'spawnClaudeCodeProcess must be a function',
      })
      .optional(),
    sdkOptions: z.record(z.string(), z.any()).optional(),
    maxToolResultSize: z.number().int().min(100).max(1000000).optional(),
    // Callback invoked when Query object is created - for mid-stream injection via streamInput()
    onQueryCreated: z
      .any()
      .refine((val) => val === undefined || typeof val === 'function', {
        message: 'onQueryCreated must be a function',
      })
      .optional(),
    onStreamStart: z
      .any()
      .refine((val) => val === undefined || typeof val === 'function', {
        message: 'onStreamStart must be a function',
      })
      .optional(),
    // Callback invoked with the predicted next user prompt (requires promptSuggestions: true)
    onPromptSuggestion: z
      .any()
      .refine((val) => val === undefined || typeof val === 'function', {
        message: 'onPromptSuggestion must be a function',
      })
      .optional(),
  })
  .strict();

/**
 * Validates a model ID and returns warnings if needed.
 *
 * @param modelId - The model ID to validate
 * @returns Warning message if model is unknown, undefined otherwise
 */
export function validateModelId(modelId: string): string | undefined {
  const knownModels = ['opus', 'sonnet', 'haiku'];

  // Check for empty or whitespace-only
  if (!modelId || modelId.trim() === '') {
    throw new Error('Model ID cannot be empty');
  }

  // Warn about unknown models but allow them
  if (!knownModels.includes(modelId)) {
    return `Unknown model ID: '${modelId}'. Proceeding with custom model. Known models are: ${knownModels.join(', ')}`;
  }

  return undefined;
}

/**
 * Validates Claude Code settings and returns validation results.
 *
 * @param settings - The settings object to validate
 * @returns Object with validation results and any warnings
 */
export function validateSettings(settings: unknown): {
  valid: boolean;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  try {
    // Parse with Zod schema
    const result = claudeCodeSettingsSchema.safeParse(settings);

    if (!result.success) {
      // Extract user-friendly error messages
      // Support both Zod v3 (errors) and v4 (issues)
      const errorObject = result.error as {
        errors?: Array<{ path: string[]; message: string }>;
        issues?: Array<{ path: string[]; message: string }>;
      };
      const issues = errorObject.errors || errorObject.issues || [];
      issues.forEach((err: { path: string[]; message: string }) => {
        const path = err.path.join('.');
        errors.push(`${path ? `${path}: ` : ''}${err.message}`);
      });
      return { valid: false, warnings, errors };
    }

    // Additional validation warnings
    const validSettings = result.data;

    // SDK constraint: sessionStore mirroring requires local session writes,
    // so it cannot be combined with persistSession: false.
    if (validSettings.sessionStore !== undefined && validSettings.persistSession === false) {
      errors.push(
        'sessionStore cannot be combined with persistSession: false. Transcript mirroring requires local session writes; remove persistSession: false or drop sessionStore.'
      );
      return { valid: false, warnings, errors };
    }

    // Warn about high turn limits
    if (validSettings.maxTurns && validSettings.maxTurns > 20) {
      warnings.push(
        `High maxTurns value (${validSettings.maxTurns}) may lead to long-running conversations`
      );
    }

    // Warn about very high thinking tokens
    if (validSettings.maxThinkingTokens && validSettings.maxThinkingTokens > 50000) {
      warnings.push(
        `Very high maxThinkingTokens (${validSettings.maxThinkingTokens}) may increase response time`
      );
    }

    // Check if both allowedTools and disallowedTools are specified
    if (validSettings.allowedTools && validSettings.disallowedTools) {
      warnings.push(
        'Both allowedTools and disallowedTools are specified. Only allowedTools will be used.'
      );
    }

    // Validate tool name format
    const validateToolNames = (tools: string[], type: string) => {
      tools.forEach((tool) => {
        // Basic validation - tool names should be alphanumeric with optional specifiers
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\([^)]*\))?$/.test(tool) && !tool.startsWith('mcp__')) {
          warnings.push(`Unusual ${type} tool name format: '${tool}'`);
        }
      });
    };

    if (validSettings.allowedTools) {
      validateToolNames(validSettings.allowedTools, 'allowed');
    }

    if (validSettings.disallowedTools) {
      validateToolNames(validSettings.disallowedTools, 'disallowed');
    }

    // supportedDialogKinds is only meaningful alongside onUserDialog; the SDK
    // throws at option intake when a non-empty list is passed without the
    // callback, so surface the mistake early as a validation warning.
    // An empty list does not throw, and onUserDialog may be supplied via the
    // sdkOptions escape hatch (merged after settings), so neither case warns.
    const sdkOptionsOnUserDialog = (validSettings.sdkOptions as Record<string, unknown> | undefined)
      ?.onUserDialog;
    if (
      validSettings.supportedDialogKinds !== undefined &&
      validSettings.supportedDialogKinds.length > 0 &&
      validSettings.onUserDialog == null &&
      sdkOptionsOnUserDialog == null
    ) {
      warnings.push(
        'supportedDialogKinds is set without onUserDialog. The SDK requires the onUserDialog callback to render declared dialog kinds and throws when a non-empty list is passed without it.'
      );
    }

    // Warn about Skills configuration issues
    if (validSettings.allowedTools?.includes('Skill') && !validSettings.settingSources) {
      warnings.push(
        "allowedTools includes 'Skill' but settingSources is not set. Skills require settingSources (e.g., ['user', 'project']) to load skill definitions."
      );
    }

    // SDK 0.3.x accepts any string for agents[].model (alias or full model ID),
    // so the schema no longer rejects typos. Warn (but allow) when a value looks
    // like neither a known alias nor a full model ID, to catch typo'd aliases
    // at validation time instead of failing later in the CLI.
    if (validSettings.agents) {
      const knownAgentModelAliases = ['sonnet', 'opus', 'haiku', 'inherit'];
      for (const [agentName, agent] of Object.entries(validSettings.agents)) {
        const agentModel = agent.model;
        if (
          agentModel !== undefined &&
          !knownAgentModelAliases.includes(agentModel) &&
          !agentModel.includes('-')
        ) {
          warnings.push(
            `Unknown model alias '${agentModel}' for agent '${agentName}'. Known aliases are: ${knownAgentModelAliases.join(', ')}; full model IDs (e.g. 'claude-sonnet-4-5') are also accepted.`
          );
        }
      }
    }

    return { valid: true, warnings, errors };
  } catch (error) {
    errors.push(`Validation error: ${error instanceof Error ? error.message : String(error)}`);
    return { valid: false, warnings, errors };
  }
}

/**
 * Validates prompt length and format.
 *
 * @param prompt - The prompt to validate
 * @returns Warning message if prompt might cause issues
 */
export function validatePrompt(prompt: string): string | undefined {
  // Very long prompts might cause issues
  const MAX_PROMPT_LENGTH = 100000; // ~25k tokens

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return `Very long prompt (${prompt.length} characters) may cause performance issues or timeouts`;
  }

  return undefined;
}

/**
 * Validates session ID format.
 *
 * @param sessionId - The session ID to validate
 * @returns Warning message if format is unusual
 */
export function validateSessionId(sessionId: string): string | undefined {
  // Session IDs from Claude Code are typically UUID-like
  // But we don't want to be too strict as format might change
  if (sessionId && !/^[a-zA-Z0-9-_]+$/.test(sessionId)) {
    return `Unusual session ID format. This may cause issues with session resumption.`;
  }

  return undefined;
}
