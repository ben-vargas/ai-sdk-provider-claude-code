/**
 * Example: PreToolUse decisions + canUseTool deny + permissionDenials metadata
 *
 * Demonstrates the SDK 0.3.x permission vocabulary:
 * - A PreToolUse hook that returns permissionDecision 'allow' for known-safe
 *   tools and makes no decision for everything else, handing the decision
 *   back to the normal permission system (rules, canUseTool, etc.)
 * - A canUseTool callback (the permission system those undecided calls land
 *   in) that denies Bash at call time
 * - The denial surfacing in providerMetadata['claude-code'].permissionDenials
 *   (from the result message's permission_denials list)
 *
 * Notes on what does / does not trigger a visible denial (CLI 2.1.x):
 * - `disallowedTools` (and blanket `permissions.deny` rules) remove the tool
 *   from the model's tool list up front, so the model never attempts the call
 *   and no denial ever fires. A call-time deny (canUseTool) is required.
 * - Returning an explicit permissionDecision 'defer' from PreToolUse while
 *   canUseTool is set currently makes the deferred tool call fail with an
 *   internal error before canUseTool is consulted — so to hand a call back to
 *   the permission system, return no permissionDecision at all (as below).
 * - Read-only Bash commands (e.g. `ls`) are auto-allowed by the CLI without
 *   consulting the permission system, so the prompt asks for a mutating
 *   command (touch) to guarantee canUseTool is consulted.
 * - The PermissionDenied hook is registered below for completeness, but
 *   current CLI builds only fire it for CLI-internal auto-denials (the
 *   permissionMode 'auto' classifier) — not for host-side canUseTool denies,
 *   which your code already observes directly. Expect the metadata line, not
 *   the hook, in this example's output.
 *
 * Requires Claude Code CLI authentication and environment setup.
 */

import { streamText } from 'ai';
import { createClaudeCode } from '../dist/index.js';

// PreToolUse hook: allow read-only tools; for everything else make no
// decision, which defers the call to the permission system (canUseTool).
// Note: do NOT return permissionDecision 'defer' here when canUseTool is
// set — see the header note.
const preToolHook = async (input: any) => {
  if (input.hook_event_name === 'PreToolUse') {
    if (input.tool_name === 'Read' || input.tool_name === 'Glob') {
      console.log(`✅ PreToolUse: allowing ${input.tool_name}`);
      return {
        continue: true,
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
      };
    }
    console.log(`🤷 PreToolUse: no decision for ${input.tool_name} (permission system decides)`);
    return { continue: true };
  }
  return { continue: true };
};

// PermissionDenied hook: fires when the CLI auto-denies a tool call internally
// (currently only the permissionMode 'auto' classifier — see header note).
const permissionDeniedHook = async (input: any) => {
  if (input.hook_event_name === 'PermissionDenied') {
    console.log(`🚫 PermissionDenied: ${input.tool_name} — ${input.reason}`);
  }
  return { continue: true };
};

// canUseTool: the permission system that undecided calls land in.
// Denying here happens at call time, so the model actually attempts the
// call and the denial is recorded in the result's permission_denials.
const canUseTool = async (toolName: string, input: Record<string, unknown>) => {
  if (toolName === 'Bash') {
    console.log('⛔ canUseTool: denying Bash');
    return {
      behavior: 'deny' as const,
      message: 'Bash is not allowed in this example',
    };
  }
  console.log(`👍 canUseTool: allowing ${toolName}`);
  return { behavior: 'allow' as const, updatedInput: input };
};

async function main() {
  const provider = createClaudeCode({
    defaultSettings: {
      // Pin 'default' so a user-level defaultMode (e.g. 'auto') doesn't
      // route permission decisions to the classifier instead of canUseTool.
      permissionMode: 'default',
      // Bash reaches canUseTool (the PreToolUse hook makes no decision for
      // it) and is denied there.
      canUseTool,
      hooks: {
        PreToolUse: [{ hooks: [preToolHook] }],
        PermissionDenied: [{ hooks: [permissionDeniedHook] }],
      },
    },
  });

  // Bash is denied (no hook decision → canUseTool deny), so the model should
  // recover with an allowed read-only tool. The mutating command (touch)
  // guarantees the permission system is consulted (read-only commands are
  // auto-allowed).
  const result = streamText({
    model: provider('sonnet'),
    prompt:
      'Create an empty file named hooks-demo.txt using the Bash tool (touch). ' +
      'If Bash is denied, do not retry it — instead use the Read tool to read ' +
      'package.json and report its "name" field in one sentence.',
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
