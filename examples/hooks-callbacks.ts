/**
 * Example: Hooks and canUseTool
 *
 * Demonstrates lifecycle hooks and dynamic permission callback.
 * Requires Claude Code CLI authentication and environment setup.
 */

import { streamText } from 'ai';
import { createClaudeCode } from '../dist/index.js';
// NOTE: Migrating to Claude Agent SDK:
// - System prompt is not applied by default
// - Filesystem settings (CLAUDE.md, settings.json) are not loaded by default
// To restore old behavior, set when creating model instances, e.g.:
//   systemPrompt: { type: 'preset', preset: 'claude_code' }
//   settingSources: ['user', 'project', 'local']

// PreToolUse hook: log and allow
const preToolHook = async (input: any) => {
  if (input.hook_event_name === 'PreToolUse') {
    console.log(`🔧 About to run tool: ${input.tool_name}`);
    return {
      continue: true,
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
    };
  }
  return { continue: true };
};

// PostToolUse hook: log after tool completes
const postToolHook = async (input: any) => {
  if (input.hook_event_name === 'PostToolUse') {
    console.log(`✅ Tool completed: ${input.tool_name}`);
  }
  return { continue: true };
};

async function main() {
  const provider = createClaudeCode({
    defaultSettings: {
      hooks: {
        PreToolUse: [{ hooks: [preToolHook] }],
        PostToolUse: [{ hooks: [postToolHook] }],
      },
    },
  });

  // Use a prompt that triggers tool use so the hooks actually fire
  const result = streamText({
    model: provider('sonnet'),
    prompt: 'List the files in the current directory using the Bash tool.',
  });

  let text = '';
  for await (const chunk of result.textStream) {
    text += chunk;
  }
  console.log('Response:', text.trim());
}

main().catch((err) => {
  console.error('Example failed:', err);
  process.exit(1);
});
