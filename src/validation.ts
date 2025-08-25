import { z } from 'zod';
import { existsSync } from 'fs';

/**
 * Validation schemas and utilities for Claude Code provider inputs.
 * Uses Zod for type-safe validation following AI SDK patterns.
 */

// Helper for Zod v3/v4 compatibility
// Use a simple z.any() for functions to work with both versions
const loggerFunctionSchema = z.object({
  warn: z.any().refine((val) => typeof val === 'function', {
    message: 'warn must be a function'
  }),
  error: z.any().refine((val) => typeof val === 'function', {
    message: 'error must be a function'
  })
});

/**
 * Schema for validating Claude Code settings.
 * Ensures all settings are within acceptable ranges and formats.
 */
export const claudeCodeSettingsSchema = z.object({
  pathToClaudeCodeExecutable: z.string().optional(),
  customSystemPrompt: z.string().optional(),
  appendSystemPrompt: z.string().optional(),
  maxTurns: z.number().int().min(1).max(100).optional(),
  maxThinkingTokens: z.number().int().positive().max(100000).optional(),
  cwd: z.string().refine(
    (val) => {
      // Skip directory validation in non-Node environments
      if (typeof process === 'undefined' || !process.versions?.node) {
        return true;
      }
      return !val || existsSync(val);
    },
    { message: "Working directory must exist" }
  ).optional(),
  executable: z.enum(['bun', 'deno', 'node']).optional(),
  executableArgs: z.array(z.string()).optional(),
  permissionMode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan']).optional(),
  permissionPromptToolName: z.string().optional(),
  continue: z.boolean().optional(),
  resume: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  mcpServers: z.record(z.string(), z.union([
    // McpStdioServerConfig
    z.object({
      type: z.literal('stdio').optional(),
      command: z.string(),
      args: z.array(z.string()).optional(),
      env: z.record(z.string(), z.string()).optional()
    }),
    // McpSSEServerConfig
    z.object({
      type: z.literal('sse'),
      url: z.string(),
      headers: z.record(z.string(), z.string()).optional()
    }),
    // McpHttpServerConfig
    z.object({
      type: z.literal('http'),
      url: z.string(),
      headers: z.record(z.string(), z.string()).optional()
    })
  ])).optional(),
  verbose: z.boolean().optional(),
  logger: z.union([
    z.literal(false),
    loggerFunctionSchema
  ]).optional(),
}).strict();

/**
 * Validates a model ID and returns warnings if needed.
 * 
 * @param modelId - The model ID to validate
 * @returns Warning message if model is unknown, undefined otherwise
 */
export function validateModelId(modelId: string): string | undefined {
  const knownModels = ['opus', 'sonnet'];
  
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
      const errorObject = result.error as { errors?: Array<{ path: string[]; message: string }>; issues?: Array<{ path: string[]; message: string }> };
      const issues = errorObject.errors || errorObject.issues || [];
      issues.forEach((err: { path: string[]; message: string }) => {
        const path = err.path.join('.');
        errors.push(`${path ? `${path}: ` : ''}${err.message}`);
      });
      return { valid: false, warnings, errors };
    }
    
    // Additional validation warnings
    const validSettings = result.data;
    
    // Warn about high turn limits
    if (validSettings.maxTurns && validSettings.maxTurns > 20) {
      warnings.push(`High maxTurns value (${validSettings.maxTurns}) may lead to long-running conversations`);
    }
    
    // Warn about very high thinking tokens
    if (validSettings.maxThinkingTokens && validSettings.maxThinkingTokens > 50000) {
      warnings.push(`Very high maxThinkingTokens (${validSettings.maxThinkingTokens}) may increase response time`);
    }
    
    // Check if both allowedTools and disallowedTools are specified
    if (validSettings.allowedTools && validSettings.disallowedTools) {
      warnings.push('Both allowedTools and disallowedTools are specified. Only allowedTools will be used.');
    }
    
    // Validate tool name format
    const validateToolNames = (tools: string[], type: string) => {
      tools.forEach(tool => {
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