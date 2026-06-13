/**
 * Example: Context Usage (query.getContextUsage())
 *
 * Demonstrates the documented recipe for reading the session's context
 * window usage: capture the Query object via `onQueryCreated`, then call
 * `query.getContextUsage()` from a `Stop` hook — i.e. while the CLI
 * subprocess is still alive.
 *
 * Why the hook? `getContextUsage()` is a control-protocol round-trip to the
 * CLI subprocess. By the time `generateText`/`streamText` resolves, that
 * subprocess has exited, so a "late" call rejects with
 * `ProcessTransport is not ready for writing`. A Stop hook fires at the end
 * of the turn while the process is still running — the last moment the data
 * is reachable. Step 3 below demonstrates the failure mode on purpose.
 *
 * The provider deliberately does NOT auto-fetch context usage on every
 * request: it would add one control-protocol round-trip per request that
 * most callers never look at. Opt in with this recipe when you need it.
 *
 * Run: npx tsx examples/context-usage.ts
 */

import { generateText } from 'ai';
import { claudeCode } from '../dist/index.js';
import type { Query } from '../dist/index.js';

type ContextUsage = Awaited<ReturnType<Query['getContextUsage']>>;

async function main() {
  console.log('📐 Context Usage Example\n');

  // ============================================
  // 1. Capture the Query + fetch usage in a Stop hook
  // ============================================
  // This is the README recipe verbatim: `onQueryCreated` hands us the live
  // Query object, and the Stop hook runs at the end of the turn — while the
  // CLI subprocess is still alive — which is when getContextUsage() works.
  console.log('1️⃣  Setting up onQueryCreated + Stop hook...');

  let activeQuery: Query | undefined;
  let contextUsage: ContextUsage | undefined;

  const model = claudeCode('haiku', {
    onQueryCreated: (query) => {
      activeQuery = query;
    },
    hooks: {
      Stop: [
        {
          hooks: [
            async () => {
              contextUsage = await activeQuery?.getContextUsage();
              return { continue: true };
            },
          ],
        },
      ],
    },
  });

  // ============================================
  // 2. Run a request, then inspect the captured usage
  // ============================================
  console.log('\n2️⃣  Running generateText...');
  const result = await generateText({
    model,
    prompt: 'Reply with exactly: OK',
  });
  console.log('Assistant:', result.text.trim());

  if (!contextUsage) {
    throw new Error('Stop hook did not capture context usage — recipe failed.');
  }

  // This breakdown is only reachable through getContextUsage(); no other
  // surface (usage, providerMetadata) exposes the context-window picture.
  console.log('\nContext window usage (captured by the Stop hook):');
  console.log(`- Model:            ${contextUsage.model}`);
  console.log(`- Context window:   ${contextUsage.maxTokens.toLocaleString()} tokens`);
  console.log(
    `- Used:             ${contextUsage.totalTokens.toLocaleString()} tokens (${contextUsage.percentage.toFixed(1)}%)`
  );
  console.log(
    `- Remaining:        ${(contextUsage.maxTokens - contextUsage.totalTokens).toLocaleString()} tokens`
  );
  console.log('- Breakdown by category:');
  for (const category of contextUsage.categories) {
    if (category.tokens > 0) {
      console.log(`    ${category.name.padEnd(20)} ${category.tokens.toLocaleString()} tokens`);
    }
  }

  // ============================================
  // 3. Failure mode: calling it AFTER the turn ends
  // ============================================
  // This is why the Stop-hook timing is mandatory. generateText has resolved,
  // so the CLI subprocess is gone and the control channel is closed.
  console.log('\n3️⃣  Calling getContextUsage() after generateText resolved (expected to fail)...');
  try {
    await activeQuery?.getContextUsage();
    console.log('⚠️  Unexpected: the late call succeeded (SDK behavior may have changed).');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`✅ Rejected as expected: "${message}"`);
    console.log('   The subprocess exits when the turn ends — fetch usage from a hook instead.');
  }
}

main().catch((err) => {
  console.error('Example failed:', err);
  process.exit(1);
});
