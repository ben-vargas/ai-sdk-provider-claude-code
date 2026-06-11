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
        z
          .object({
            type: z.literal('adaptive'),
            display: z.enum(['summarized', 'omitted']).optional(),
          })
          .strict(),
        z
          .object({
            type: z.literal('enabled'),
            budgetTokens: z.number().int().positive().optional(),
            display: z.enum(['summarized', 'omitted']).optional(),
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
    // Mirrors the SDK 0.3.x PermissionMode union ('auto' and 'dontAsk' were
    // added in 0.3.x; 'delegate' was dropped AND is rejected by the CLI's
    // --permission-mode flag parser, so it is rejected here too).
    permissionMode: z
      .enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto'])
      .optional(),
    permissionPromptToolName: z.string().optional(),
    continue: z.boolean().optional(),
    resume: z.string().optional(),
    // The CLI rejects --session-id values that are not valid UUIDs, so
    // enforce the UUID shape here instead of failing at query time.
    sessionId: z
      .string()
      .refine(
        (val) =>
          /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(val),
        { message: 'sessionId must be a valid UUID (the CLI rejects non-UUID session IDs)' }
      )
      .optional(),
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
            // SDK SdkPluginConfig: only 'local' is supported; the SDK throws
            // 'Unsupported plugin type' at query time for anything else.
            type: z.literal('local'),
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
  const knownModels = ['opus', 'sonnet', 'haiku', 'fable'];

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

    // sdkOptions escape-hatch values are merged over explicit settings at
    // query time (undefined-valued keys are skipped by the merge), so every
    // cross-option SDK-constraint check below must inspect the EFFECTIVE
    // value - the sdkOptions override when defined, the first-class setting
    // otherwise - on BOTH sides of each constraint.
    const sdkOptionsRecord = validSettings.sdkOptions as Record<string, unknown> | undefined;
    const effective = (key: string): unknown => {
      const override = sdkOptionsRecord?.[key];
      return override !== undefined ? override : (validSettings as Record<string, unknown>)[key];
    };
    const effSessionStore = effective('sessionStore');

    // SDK constraint: sessionStore mirroring requires local session writes,
    // so it cannot be combined with persistSession: false.
    if (effSessionStore !== undefined && effective('persistSession') === false) {
      errors.push(
        'sessionStore cannot be combined with persistSession: false. Transcript mirroring requires local session writes; remove persistSession: false or drop sessionStore.'
      );
      return { valid: false, warnings, errors };
    }

    // SDK constraint: checkpoint backup blobs are not mirrored to a sessionStore,
    // so rewindFiles() would fail after a store-backed resume. The SDK throws at
    // query time; reject early here instead.
    if (effSessionStore !== undefined && effective('enableFileCheckpointing') === true) {
      errors.push(
        'sessionStore cannot be combined with enableFileCheckpointing: true. Checkpoint backup blobs are not mirrored to the store (rewindFiles() fails after a store-backed resume); remove enableFileCheckpointing or drop sessionStore.'
      );
      return { valid: false, warnings, errors };
    }

    // SDK constraint: continue with a sessionStore needs store.listSessions()
    // to discover the most recent session (unless a resume id is given).
    // The SDK throws at query time; reject early here instead.
    if (
      effective('continue') === true &&
      effSessionStore !== undefined &&
      effective('resume') === undefined &&
      typeof (effSessionStore as { listSessions?: unknown }).listSessions !== 'function'
    ) {
      errors.push(
        'continue: true with sessionStore requires the store to implement listSessions() (used to discover the most recent session). Implement listSessions(), pass resume with an explicit session ID, or drop continue.'
      );
      return { valid: false, warnings, errors };
    }

    // SDK constraint: the sandbox option cannot be combined with a settings
    // FILE PATH (inline Settings objects are fine - the SDK serializes them
    // to inline JSON). The SDK throws at query time; reject early here instead.
    const effSettingsOption = effective('settings');
    if (
      effective('sandbox') !== undefined &&
      typeof effSettingsOption === 'string' &&
      !(effSettingsOption.trim().startsWith('{') && effSettingsOption.trim().endsWith('}'))
    ) {
      errors.push(
        'sandbox cannot be combined with a settings file path. Pass settings as an inline Settings object, or move the sandbox configuration into the settings file and drop the sandbox option.'
      );
      return { valid: false, warnings, errors };
    }

    // CLI constraint: --session-id cannot be combined with --continue or
    // --resume unless --fork-session is also set (to name the forked
    // session's ID). The CLI rejects the flags at argv parsing; reject early
    // here instead.
    if (
      effective('sessionId') !== undefined &&
      effective('forkSession') !== true &&
      (effective('continue') === true || effective('resume') !== undefined)
    ) {
      errors.push(
        "sessionId cannot be combined with continue or resume unless forkSession: true is also set (it then names the forked session's ID). Remove sessionId, remove continue/resume, or add forkSession: true."
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

    // SDK constraint: a non-empty supportedDialogKinds without an onUserDialog
    // handler throws at option intake ("declaring dialog kinds without a
    // handler would park dialogs nothing can answer"), so reject it instead
    // of warning - the query would fail at startup anyway. An empty list does
    // not throw, and onUserDialog may arrive via the sdkOptions escape hatch.
    const effDialogKinds = effective('supportedDialogKinds');
    if (
      Array.isArray(effDialogKinds) &&
      effDialogKinds.length > 0 &&
      effective('onUserDialog') == null
    ) {
      errors.push(
        'supportedDialogKinds is set without onUserDialog. The SDK requires the onUserDialog callback to render declared dialog kinds and throws when a non-empty list is passed without it; provide onUserDialog or remove supportedDialogKinds.'
      );
      return { valid: false, warnings, errors };
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
      const knownAgentModelAliases = ['sonnet', 'opus', 'haiku', 'fable', 'inherit'];
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
