/**
 * Example: Tool Management
 *
 * This example demonstrates how to manage tool permissions for Claude Code.
 * The allowedTools and disallowedTools flags work for BOTH:
 * - Built-in Claude tools (Bash, Edit, Read, Write, etc.)
 * - MCP tools (mcp__serverName__toolName format)
 *
 * These are session-only permission overrides that use the same rule syntax
 * as settings.json permissions.
 */

import { streamText } from 'ai';
import { createClaudeCode } from '../dist/index.js';
// NOTE: Migrating to Claude Agent SDK:
// - System prompt is not applied by default
// - Filesystem settings (CLAUDE.md, settings.json) are not loaded by default
// To restore old behavior, set when creating model instances, e.g.:
//   systemPrompt: { type: 'preset', preset: 'claude_code' }
//   settingSources: ['user', 'project', 'local']

async function testToolManagement() {
  console.log('🔧 Testing Claude Code Tool Management\n');

  // 1. Default behavior - all tools allowed
  console.log('1️⃣  Default (all tools allowed)');
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
    console.log('   (All built-in and MCP tools would be allowed)');
  } catch (error) {
    console.error('Error:', error);
  }

  console.log('\n2️⃣  Built-in tools: Allow only Bash commands');
  // 2. Allow only specific Bash commands
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
    console.log('   (Only allowed specific Bash commands)');
  } catch (error) {
    console.error('Error:', error);
  }

  console.log('\n3️⃣  Built-in tools: Block dangerous operations');
  // 3. Block file modifications but allow reading
  const readOnlyClaude = createClaudeCode({
    defaultSettings: {
      disallowedTools: ['Write', 'Edit', 'Delete', 'Bash(rm:*)', 'Bash(sudo:*)'],
    },
  });

  try {
    const result3 = streamText({
      model: readOnlyClaude('opus'),
      prompt: 'What is the capital of France? Just the city name.',
    });

    // Collect text from stream
    let response3 = '';
    for await (const chunk of result3.textStream) {
      response3 += chunk;
    }
    console.log('Response:', response3.trim());
    console.log('   (Can read files but not write/edit/delete)');
  } catch (error) {
    console.error('Error:', error);
  }

  console.log('\n4️⃣  Mixed: Built-in tools + MCP tools');
  // 4. Allow specific built-in tools and MCP tools
  const mixedClaude = createClaudeCode({
    defaultSettings: {
      allowedTools: [
        'Read',
        'LS',
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
    console.log('   (Only allowed read operations and git status)');
  } catch (error) {
    console.error('Error:', error);
  }

  console.log('\n5️⃣  Security lockdown: No tools at all');
  // 5. Maximum security - explicit empty allowlist blocks all tools
  const noToolsClaude = createClaudeCode({
    defaultSettings: {
      allowedTools: [], // Empty array = explicit empty allowlist = NO tools allowed
    },
  });

  try {
    const result5 = streamText({
      model: noToolsClaude('opus'),
      prompt: 'What programming language is this: console.log("Hello")?',
    });

    // Collect text from stream
    let response5 = '';
    for await (const chunk of result5.textStream) {
      response5 += chunk;
    }
    console.log('Response:', response5.trim());
    console.log('   (No tools allowed - explicit empty allowlist blocks everything)');
  } catch (error) {
    console.error('Error:', error);
  }

  console.log('\n6️⃣  Model-specific override');
  // 6. Model-specific settings override provider settings
  const baseClaude = createClaudeCode({
    defaultSettings: {
      disallowedTools: ['Bash', 'Write'], // Provider blocks these
    },
  });

  try {
    const result6 = streamText({
      model: baseClaude('opus', {
        // Override to allow everything for this specific call
        disallowedTools: [],
      }),
      prompt: 'Name a popular web framework.',
    });

    // Collect text from stream
    let response6 = '';
    for await (const chunk of result6.textStream) {
      response6 += chunk;
    }
    console.log('Response:', response6.trim());
    console.log('   (Model override allows all tools for this call)');
  } catch (error) {
    console.error('Error:', error);
  }

  console.log('\n✅ Tool management examples completed!');

  console.log('\n📝 Key Points:');
  console.log('- Flags work for BOTH built-in tools AND MCP tools');
  console.log('- Same rule syntax as settings.json permissions');
  console.log('- Session-only overrides (higher priority than settings files)');
  console.log('- Use specifiers for fine-grained control: Bash(git:*)');
  console.log('- Empty allowedTools ([]) = Explicit empty allowlist = No tools allowed');
  console.log('- Omitting flags entirely = Falls back to normal permission system');

  console.log('\n🛠️  Built-in tool names:');
  console.log('- Bash, Edit, Read, Write, Delete, LS, Grep, Glob');
  console.log('- WebFetch, NotebookRead, NotebookEdit');
  console.log('- Use /permissions in Claude to see all available tools');

  console.log('\n🔌 MCP tool format:');
  console.log('- mcp__<serverName> (all tools from that server)');
  console.log('- mcp__<serverName>__<toolName> (specific tool)');

  console.log('\n🔒 Security patterns:');
  console.log('- Read-only: disallowedTools: ["Write", "Edit", "Delete"]');
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
