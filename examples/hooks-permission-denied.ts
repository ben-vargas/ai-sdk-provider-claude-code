/**
 * Example: PermissionDenied hook + PreToolUse 'defer'
 *
 * Demonstrates the SDK 0.3.x permission vocabulary:
 * - A PreToolUse hook that allows known-safe tools and returns
 *   permissionDecision 'defer' for everything else, handing the decision
 *   back to the normal permission system (rules, canUseTool, etc.)
 * - A PermissionDenied hook that observes tools auto-denied without a
 *   prompt (here: Bash, denied via disallowedTools after the hook defers)
 *
 * Denials also surface in providerMetadata['claude-code'].permissionDenials.
 * Requires Claude Code CLI authentication and environment setup.
 */

import { streamText } from 'ai';
import { createClaudeCode } from '../dist/index.js';

// PreToolUse hook: allow read-only tools, defer everything else to the
// permission system ('defer' means this hook makes no decision).
const preToolHook = async (input: any) => {
  if (input.hook_event_name === 'PreToolUse') {
    if (input.tool_name === 'Read' || input.tool_name === 'Glob') {
      console.log(`✅ PreToolUse: allowing ${input.tool_name}`);
      return {
        continue: true,
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
      };
    }
    console.log(`🤷 PreToolUse: deferring ${input.tool_name} to the permission system`);
    return {
      continue: true,
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'defer' },
    };
  }
  return { continue: true };
};

// PermissionDenied hook: fires when a tool call is auto-denied without a
// prompt (e.g. by disallowedTools after the PreToolUse hook deferred).
const permissionDeniedHook = async (input: any) => {
  if (input.hook_event_name === 'PermissionDenied') {
    console.log(`🚫 PermissionDenied: ${input.tool_name} — ${input.reason}`);
  }
  return { continue: true };
};

async function main() {
  const provider = createClaudeCode({
    defaultSettings: {
      // Bash is deferred by the PreToolUse hook, then denied here,
      // which triggers the PermissionDenied hook.
      disallowedTools: ['Bash'],
      hooks: {
        PreToolUse: [{ hooks: [preToolHook] }],
        PermissionDenied: [{ hooks: [permissionDeniedHook] }],
      },
    },
  });

  // Bash is denied (defer → disallowedTools), so the model should recover
  // with an allowed read-only tool.
  const result = streamText({
    model: provider('sonnet'),
    prompt: 'List the files in the current directory. Try the Bash tool first.',
  });

  let text = '';
  for await (const chunk of result.textStream) {
    text += chunk;
  }
  console.log('Response:', text.trim());

  const metadata = (await result.providerMetadata)?.['claude-code'];
  if (metadata?.permissionDenials) {
    console.log('Permission denials (providerMetadata):', metadata.permissionDenials);
  }
}

main().catch((err) => {
  console.error('Example failed:', err);
  process.exit(1);
});
