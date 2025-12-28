/**
 * Example: Skills Configuration
 *
 * This example demonstrates how to configure Skills support in Claude Code.
 * Skills allow Claude to access custom tools and capabilities defined in
 * your user or project settings.
 *
 * Skills are loaded from:
 * - User settings: ~/.claude/skills/ directory
 * - Project settings: .claude/skills/ directory in your project
 *
 * Requirements for Skills to work:
 * 1. settingSources must include the sources where skills are defined
 * 2. The 'Skill' tool must be allowed (in allowedTools)
 *
 * NOTE: If you add 'Skill' to allowedTools but forget to set settingSources,
 * you'll get a validation warning - skills won't load without settingSources!
 */

import { streamText } from 'ai';
import { createClaudeCode, claudeCode } from '../dist/index.js';

async function demonstrateSkills() {
  console.log('🎯 Claude Code Skills Configuration Examples\n');

  // ============================================
  // Example 1: Default behavior (no skills)
  // ============================================
  console.log('1️⃣  Default behavior (Skills disabled)');
  console.log('   - No settingSources configured');
  console.log('   - Skills are not available');

  const defaultModel = claudeCode('sonnet');
  // This model cannot use skills

  console.log('   Model created without skills support\n');

  // ============================================
  // Example 2: Enable Skills (recommended config)
  // ============================================
  console.log('2️⃣  Enable Skills (recommended)');
  console.log('   - settingSources: ["user", "project"]');
  console.log('   - allowedTools includes "Skill"');

  const skillsModel = claudeCode('sonnet', {
    settingSources: ['user', 'project'],
    allowedTools: ['Skill', 'Read', 'Write', 'Bash'],
  });

  console.log('   Model created with skills support enabled\n');

  // ============================================
  // Example 3: Enable Skills at provider level
  // ============================================
  console.log('3️⃣  Enable Skills at provider level');
  console.log('   - All models from this provider have Skills available');

  const skillsProvider = createClaudeCode({
    defaultSettings: {
      settingSources: ['user', 'project'],
      allowedTools: ['Skill', 'Read', 'Write', 'Bash'],
    },
  });

  const modelFromProvider = skillsProvider('sonnet');

  console.log('   Provider created with default skills support\n');

  // ============================================
  // Example 4: Project-only skills
  // ============================================
  console.log('4️⃣  Project-only skills');
  console.log('   - Only load skills from project, not user settings');

  const projectOnlyModel = claudeCode('sonnet', {
    settingSources: ['project'],
    allowedTools: ['Skill', 'Read'],
  });

  console.log('   Model created with project-only skills\n');

  // ============================================
  // Example 5: Common mistake (triggers warning)
  // ============================================
  console.log('5️⃣  Common mistake: Skill in allowedTools but no settingSources');
  console.log('   - This will trigger a validation warning!');
  console.log('   - Skills cannot load without settingSources');

  // This configuration will emit a warning:
  // "allowedTools includes 'Skill' but settingSources is not set"
  const misconfiguredModel = claudeCode('sonnet', {
    allowedTools: ['Skill', 'Read'], // Skill added, but...
    // settingSources not set! Skills won't actually load.
  });

  console.log('   (Check console for validation warning)\n');

  // ============================================
  // Usage Example with Streaming
  // ============================================
  console.log('📝 Example Usage with streamText:');
  console.log('');
  console.log(`
const { textStream } = streamText({
  model: claudeCode('sonnet', {
    settingSources: ['user', 'project'],
    allowedTools: ['Skill', 'Read', 'Write', 'Bash'],
  }),
  prompt: 'Use my /custom-skill to help me with this task',
});

for await (const chunk of textStream) {
  process.stdout.write(chunk);
}
`);

  console.log('✅ Skills configuration examples completed!\n');

  console.log('📖 Key Points:');
  console.log('- settingSources must be set for skills to load');
  console.log("- 'Skill' must be in allowedTools to invoke skills");
  console.log('- Validation warns if Skill is allowed but settingSources is missing');
  console.log('- Model-level settings override provider defaults\n');

  console.log('📁 Where to define Skills:');
  console.log('- User: ~/.claude/skills/your-skill/SKILL.md');
  console.log('- Project: .claude/skills/your-skill/SKILL.md');
  console.log('- See Claude Code documentation for skill definition syntax\n');
}

// Run the demonstration
demonstrateSkills()
  .then(() => {
    console.log('Examples completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Example failed:', error);
    process.exit(1);
  });
