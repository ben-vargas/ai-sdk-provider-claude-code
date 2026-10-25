/**
 * Example: Tool Management
 *
 * This example demonstrates how to manage tool access for Claude Code:
 * - `tools` sets which built-in tools exist (`[]` = none). MCP tools are
 *   controlled separately (mcpServers and permission rules).
 * - `allowedTools` pre-approves tools so they run without a permission
 *   prompt. It does NOT restrict which tools are available.
 * - `disallowedTools` denies tools. The two lists can be combined, and
 *   matching deny rules take precedence.
 *
 * allowedTools and disallowedTools work for BOTH built-in Claude tools
 * (Bash, Edit, Read, Write, etc.) and MCP tools (mcp__serverName__toolName).
 * They are session-only permission rules that use the same rule syntax as
 * settings.json permissions.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { streamText } from 'ai';
import { createClaudeCode } from '../dist/index.js';
// NOTE: Migrating to Claude Agent SDK:
// - System prompt is not applied by default
// - Filesystem settings (CLAUDE.md, settings.json) are not loaded by default
// To restore old behavior, set when creating model instances, e.g.:
//   systemPrompt: { type: 'preset', preset: 'claude_code' }
//   settingSources: ['user', 'project', 'local']

// Stream a response and record the names of the tools Claude called.
async function collect(result: ReturnType<typeof streamText>) {
  let text = '';
  const toolCalls: string[] = [];
  for await (const part of result.fullStream) {
    if (part.type === 'text-start' && text) text += '\n';
    if (part.type === 'text-delta') text += part.text;
    if (part.type === 'tool-call') toolCalls.push(part.toolName);
  }
  return { text: text.trim(), toolCalls };
}

async function testToolManagement() {
  console.log('🔧 Testing Claude Code Tool Management\n');

  // 1. Default behavior - no tool settings
  console.log('1️⃣  Default (no tool settings)');
  const defaultClaude = createClaudeCode();

  try {
    const result1 = streamText({
      model: defaultClaude('opus'),
      prompt: 'What is 2 + 2? Just give me the number.',
    });

    // Collect text from stream
    let response1 = '';
    for await (const chunk of result1.textStream) {
      response1 += chunk;
    }
    console.log('Response:', response1.trim());
    console.log('   (All default tools are available; normal permissions apply)');
  } catch (error) {
    console.error('Error:', error);
  }

  console.log('\n2️⃣  Built-in tools: Pre-approve specific Bash commands');
  // 2. Pre-approve specific Bash commands (other tools still follow normal permissions)
  const bashOnlyClaude = createClaudeCode({
    defaultSettings: {
      allowedTools: ['Bash(echo:*)', 'Bash(date)', 'Bash(pwd)'],
    },
  });

  try {
    const result2 = streamText({
      model: bashOnlyClaude('opus'),
      prompt: 'Can you show me the current date? Use the date command.',
    });

    // Collect text from stream
    let response2 = '';
    for await (const chunk of result2.textStream) {
      response2 += chunk;
    }
    console.log('Response:', response2.trim());
    console.log('   (These Bash commands run without prompting; other tools are not removed)');
  } catch (error) {
    console.error('Error:', error);
  }

  console.log('\n3️⃣  Built-in tools: Block dangerous operations');
  // 3. Remove the file-editing tools and deny matching rm/sudo commands.
  // Bash itself stays available, so this is not read-only (see the
  // "Security patterns" list below for a read-only setup).
  const safeClaude = createClaudeCode({
    defaultSettings: {
      disallowedTools: ['Write', 'Edit', 'NotebookEdit', 'Bash(rm:*)', 'Bash(sudo:*)'],
    },
  });

  try {
    const result3 = streamText({
      model: safeClaude('opus'),
      prompt: 'What is the capital of France? Just the city name.',
    });

    // Collect text from stream
    let response3 = '';
    for await (const chunk of result3.textStream) {
      response3 += chunk;
    }
    console.log('Response:', response3.trim());
    console.log(
      '   (Write, Edit and NotebookEdit are removed; Bash calls matching rm/sudo are denied)'
    );
  } catch (error) {
    console.error('Error:', error);
  }

  console.log('\n4️⃣  Mixed: Built-in tools + MCP tools');
  // 4. Pre-approve specific built-in tools and MCP tools
  const mixedClaude = createClaudeCode({
    defaultSettings: {
      allowedTools: [
        'Read',
        'Glob',
        'Bash(git log:*)',
        'Bash(git status)',
        'mcp__filesystem__read_text_file',
        'mcp__git__status',
      ],
    },
  });

  try {
    const result4 = streamText({
      model: mixedClaude('opus'),
      prompt: 'What is the result of 5 * 8?',
    });

    // Collect text from stream
    let response4 = '';
    for await (const chunk of result4.textStream) {
      response4 += chunk;
    }
    console.log('Response:', response4.trim());
    console.log('   (Listed tools run without prompting; this does not restrict other tools)');
  } catch (error) {
    console.error('Error:', error);
  }

  console.log('\n5️⃣  Security lockdown: No built-in tools');
  // 5. Remove every built-in tool with `tools: []`. (`allowedTools: []` would
  // only pre-approve nothing; it would not remove any tools.)
  const noToolsClaude = createClaudeCode({
    defaultSettings: {
      tools: [], // Empty array = no built-in tools; MCP tools are controlled separately
    },
  });

  try {
    const result5 = await collect(
      streamText({
        model: noToolsClaude('opus'),
        prompt:
          'Use the Bash tool to run `pwd`. If you have no tools, say so in one sentence instead.',
      })
    );
    console.log('Response:', result5.text);
    console.log('Tool calls:', result5.toolCalls.length ? result5.toolCalls.join(', ') : 'none');
    console.log('   (No built-in tools exist, so Claude cannot run Bash)');
  } catch (error) {
    console.error('Error:', error);
  }

  console.log('\n6️⃣  Combining allowedTools and disallowedTools');
  // 6. Both lists apply together and matching deny rules win: Read is
  // pre-approved AND denied, so it is removed; Bash stays pre-approved.
  const workDir = mkdtempSync(join(tmpdir(), 'tool-management-'));
  writeFileSync(join(workDir, 'note.txt'), 'hello from note.txt\n');
  const combinedClaude = createClaudeCode({
    defaultSettings: {
      cwd: workDir,
      allowedTools: ['Bash', 'Read'],
      disallowedTools: ['Read'],
    },
  });

  try {
    const result6 = await collect(
      streamText({
        model: combinedClaude('opus'),
        prompt:
          'Show me the contents of note.txt. Use the Read tool if you have it; otherwise run `cat note.txt` with Bash.',
      })
    );
    console.log('Response:', result6.text);
    console.log('Tool calls:', result6.toolCalls.length ? result6.toolCalls.join(', ') : 'none');
    console.log('   (Read is denied even though it is pre-approved; Bash still runs)');
  } catch (error) {
    console.error('Error:', error);
  }

  console.log('\n7️⃣  Model-specific override');
  // 7. Model-specific settings override provider settings
  const baseClaude = createClaudeCode({
    defaultSettings: {
      disallowedTools: ['Bash', 'Write'], // Provider blocks these
    },
  });

  try {
    const result7 = streamText({
      model: baseClaude('opus', {
        // Clear the provider-level deny list for this specific call
        disallowedTools: [],
      }),
      prompt: 'Name a popular web framework.',
    });

    // Collect text from stream
    let response7 = '';
    for await (const chunk of result7.textStream) {
      response7 += chunk;
    }
    console.log('Response:', response7.trim());
    console.log('   (Model override clears the deny list; normal permissions apply)');
  } catch (error) {
    console.error('Error:', error);
  }

  console.log('\n✅ Tool management examples completed!');

  console.log('\n📝 Key Points:');
  console.log('- Flags work for BOTH built-in tools AND MCP tools');
  console.log('- Same rule syntax as settings.json permissions');
  console.log('- Session-only rules, added to settings-file rules; deny rules always win');
  console.log('- Use specifiers for fine-grained control: Bash(git:*)');
  console.log('- allowedTools pre-approves tools; it does not restrict which tools exist');
  console.log('- tools restricts built-in tools (tools: [] = none); MCP tools are separate');
  console.log('- allowedTools and disallowedTools can be combined; deny wins');
  console.log('- Omitting flags entirely = Falls back to normal permission system');

  console.log('\n🛠️  Built-in tool names:');
  console.log('- Bash, Edit, Read, Write, Grep, Glob');
  console.log('- WebFetch, WebSearch, NotebookEdit');
  console.log('- Use /permissions in Claude to see all available tools');

  console.log('\n🔌 MCP tool format:');
  console.log('- mcp__<serverName> (all tools from that server)');
  console.log('- mcp__<serverName>__<toolName> (specific tool)');

  console.log('\n🔒 Security patterns:');
  console.log('- Read-only built-ins: tools: ["Read", "Grep", "Glob"] (MCP tools are separate)');
  console.log('- Denying only Write/Edit is not read-only: Bash can still write files');
  console.log('- No shell: disallowedTools: ["Bash"]');
  console.log('- Safe git: allowedTools: ["Bash(git log:*)", "Bash(git diff:*)"]');
}

// Run the examples
testToolManagement()
  .then(() => {
    console.log('\nAll examples completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nExample failed:', error);
    process.exit(1);
  });
