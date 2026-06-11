/**
 * Example: The `skills` Setting (single-switch skills enablement)
 *
 * The Claude Agent SDK 0.3 `skills` option is the one place to turn skills
 * on: pass `skills: ['name', ...]` (or `'all'`) and the SDK wires up the
 * Skill tool for you — no `allowedTools: ['Skill']` needed. Compare with
 * examples/skills-management.ts, which shows the legacy path where you had
 * to add 'Skill' to allowedTools yourself.
 *
 * Note: `settingSources` is still required — that is how skill definitions
 * are discovered on the filesystem (.claude/skills/ in user/project dirs).
 * `skills` then filters which discovered skills the session can see.
 *
 * This example is fully self-contained: it creates a throwaway project
 * directory with a trivial deterministic skill (echo-cipher: reverse the
 * text and wrap it in <cipher>...</cipher>), then proves:
 *   1. With skills: ['echo-cipher'] the Skill tool fires and the answer
 *      contains the <cipher> marker — with NO allowedTools wiring at all.
 *   2. With skills: [] the same prompt cannot execute the skill — the model
 *      may still attempt the Skill call (the name is in the prompt), but
 *      the SDK rejects it: "not in the skills allowlist". The skill's
 *      instructions never run, so no <cipher> output is produced.
 *
 * `skills` is an enablement allowlist, not a sandbox: with skills: [] the
 * SKILL.md file still exists on disk and is readable by file tools; the SDK
 * just refuses to execute it as a skill.
 *
 * Usage: npx tsx examples/skills-option.ts
 */

import { streamText } from 'ai';
import { claudeCode } from '../dist/index.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SKILL_MD = `---
name: echo-cipher
description: Encode text with the echo-cipher. Use whenever the user asks to encode text with the echo-cipher skill.
---

# Echo Cipher

To encode text with the echo-cipher:
1. Reverse the characters of the input text.
2. Wrap the reversed text in <cipher>...</cipher>.

Reply with only the encoded result, nothing else.
`;

const PROMPT = 'Use the echo-cipher skill to encode: hello world';

/**
 * Run the prompt and report whether the Skill tool was invoked and what
 * the final text was. Returns the observable evidence for each step.
 */
async function runWithSkills(tempDir: string, skills: string[]) {
  const result = streamText({
    model: claudeCode('haiku', {
      cwd: tempDir,
      // Required: skills are discovered from filesystem setting sources.
      settingSources: ['project'],
      // The new single switch. Note: NO allowedTools here — that's the point.
      skills,
    }),
    prompt: PROMPT,
  });

  let skillToolInput: string | undefined;
  let skillToolResult: string | undefined;
  let text = '';

  for await (const part of result.fullStream) {
    if (part.type === 'tool-call' && part.toolName === 'Skill') {
      skillToolInput = JSON.stringify(part.input);
    } else if (part.type === 'tool-result' && part.toolName === 'Skill') {
      skillToolResult = JSON.stringify(part.output);
    } else if (part.type === 'tool-error' && part.toolName === 'Skill') {
      // Allowlist rejections surface as tool errors
      skillToolResult = `ERROR: ${JSON.stringify(part.error)}`;
    } else if (part.type === 'text-delta') {
      text += part.text;
    }
  }

  return { skillToolInput, skillToolResult, text: text.trim() };
}

async function main() {
  // ============================================
  // 1. Create a temp project with a skill
  // ============================================
  console.log('1️⃣  Creating temp project with .claude/skills/echo-cipher/SKILL.md');
  const tempDir = await mkdtemp(join(tmpdir(), 'skills-option-'));
  const skillDir = join(tempDir, '.claude', 'skills', 'echo-cipher');
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), SKILL_MD);
  console.log(`   Temp project: ${tempDir}\n`);

  try {
    // ============================================
    // 2. Positive case: skills: ['echo-cipher']
    // ============================================
    console.log("2️⃣  skills: ['echo-cipher'] — no 'Skill' in allowedTools");
    console.log(`   Prompt: ${PROMPT}`);
    const enabled = await runWithSkills(tempDir, ['echo-cipher']);

    console.log(`   Skill tool-call observed: ${enabled.skillToolInput ?? 'NONE'}`);
    console.log(`   Final text: ${enabled.text}`);

    const invoked = enabled.skillToolInput !== undefined;
    const encoded = enabled.text.includes('<cipher>');
    console.log(`   ✅ Skill invoked: ${invoked} | <cipher> marker in output: ${encoded}\n`);
    if (!invoked || !encoded) {
      throw new Error('Expected the echo-cipher skill to be invoked and applied.');
    }

    // ============================================
    // 3. Negative case: skills: [] (allowlist enforcement)
    // ============================================
    console.log('3️⃣  skills: [] — same project, same prompt, skill not enabled');
    const disabled = await runWithSkills(tempDir, []);

    // The model may still ATTEMPT the Skill call (the skill name is right
    // there in the prompt), but the SDK rejects it at the allowlist.
    console.log(`   Skill tool-call attempted: ${disabled.skillToolInput ?? 'NONE'}`);
    console.log(`   Skill tool result: ${disabled.skillToolResult ?? 'NONE'}`);
    console.log(`   Final text: ${disabled.text}`);

    const blocked = !disabled.text.includes('<cipher>');
    console.log(`   ✅ Skill execution blocked (no <cipher> in output): ${blocked}`);
    // Note: this is enablement filtering, not a sandbox — SKILL.md is still
    // on disk and readable via file tools; it just cannot run as a skill.
    if (!blocked) {
      throw new Error('Expected the skill NOT to execute when omitted from `skills`.');
    }

    console.log('\n📖 Key points:');
    console.log("- skills: ['name'] (or 'all') enables skills in one switch");
    console.log("- No allowedTools: ['Skill'] wiring needed (legacy path: skills-management.ts)");
    console.log('- settingSources is still required for filesystem skill discovery');
    console.log('- skills is an enablement allowlist, not a sandbox');
  } finally {
    // ============================================
    // 4. Cleanup
    // ============================================
    await rm(tempDir, { recursive: true, force: true });
    console.log('\n🧹 Temp project removed.');
  }
}

main()
  .then(() => {
    console.log('\nExample completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Example failed:', error);
    process.exit(1);
  });
