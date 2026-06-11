/**
 * Example: Warm Start (startup() / WarmQuery) + Timing Metadata
 *
 * Demonstrates the Agent SDK's warm-start path and the timing fields the
 * provider reports in providerMetadata['claude-code']:
 * 1. Cold baseline: a normal generateText() call, printing ttftMs,
 *    ttftStreamMs, timeToRequestMs, durationMs, and warmSpareClaimed.
 * 2. Warm path: startup() pre-spawns the CLI subprocess and completes its
 *    initialize handshake ahead of time; warm.query(prompt) then writes the
 *    prompt straight to the ready process. We drive the raw SDK message
 *    stream ourselves and timestamp the first assistant text.
 * 3. Side-by-side comparison: cold ttftMs vs warm time-to-first-token.
 *    The warm number excludes subprocess spawn and should be visibly lower.
 * 4. Cleanup: discarding an unused WarmQuery handle with close().
 *
 * IMPORTANT LIMITATION (see README "Reducing time-to-first-token"):
 * A WarmQuery is a standalone SDK query path. Its query() method returns the
 * SDK's Query directly (usable once per handle), and the SDK exposes no way
 * to hand a pre-warmed process to the regular query() call this provider
 * invokes internally. startup() therefore CANNOT accelerate generateText or
 * streamText — it only helps when you drive the SDK Query yourself for one
 * latency-critical request.
 *
 * Run with: npx tsx examples/warm-start.ts
 */

import { generateText } from 'ai';
import { claudeCode, startup, type SDKMessage } from '../dist/index.js';

// Tiny prompt so both runs are cheap and fast.
const PROMPT = 'Reply with exactly one word: pong';

function fmt(value: unknown): string {
  return typeof value === 'number' ? `${Math.round(value)}ms` : 'not reported';
}

async function main() {
  console.log('🔥 Warm Start Example\n');

  // ============================================
  // 1. Cold baseline: generateText + timing metadata
  // ============================================
  // A regular provider call spawns a fresh CLI subprocess. The SDK reports
  // timing on the result message, which the provider surfaces in
  // providerMetadata['claude-code'].
  console.log('1️⃣  Cold baseline (generateText, fresh subprocess)...');
  const cold = await generateText({
    model: claudeCode('haiku'),
    prompt: PROMPT,
  });
  console.log('Assistant:', cold.text.trim());

  const metadata = cold.providerMetadata?.['claude-code'] as Record<string, unknown> | undefined;
  if (!metadata) {
    throw new Error('No claude-code provider metadata — cannot compare timings.');
  }

  console.log('\nTiming metadata (providerMetadata["claude-code"]):');
  console.log(`- ttftMs (time to first token):        ${fmt(metadata.ttftMs)}`);
  console.log(`- ttftStreamMs (first streamed token): ${fmt(metadata.ttftStreamMs)}`);
  console.log(`- timeToRequestMs (API request sent):  ${fmt(metadata.timeToRequestMs)}`);
  console.log(`- durationMs (total request):          ${fmt(metadata.durationMs)}`);
  // warmSpareClaimed is only present when the SDK reports it — absence
  // ("SDK said nothing") and false ("SDK said no spare was used") are
  // distinguishable by design.
  if ('warmSpareClaimed' in metadata) {
    console.log(`- warmSpareClaimed:                    ${metadata.warmSpareClaimed}`);
  } else {
    console.log('- warmSpareClaimed:                    (absent — not reported by the SDK)');
  }

  // ============================================
  // 2. Warm path: startup() + warm.query() on the raw SDK stream
  // ============================================
  // startup() does the expensive part (spawn + initialize handshake) ahead
  // of time. We wall-clock it separately to show where the cost moved.
  console.log('\n2️⃣  Warm path (startup() handshake, then warm.query())...');
  const handshakeStart = performance.now();
  // Pin settingSources: [] so the warm path uses the SAME isolation as
  // claudeCode() (which pins it by default). Without this, SDK 0.3.x would
  // load filesystem settings/hooks/MCP only on the warm run, skewing the
  // timing comparison.
  const warm = await startup({ options: { model: 'haiku', settingSources: [] } });
  const handshakeMs = performance.now() - handshakeStart;
  console.log(`startup() handshake took ${Math.round(handshakeMs)}ms (paid ahead of time)`);

  // warm.query() returns the raw SDK Query — an AsyncIterable<SDKMessage>,
  // NOT an AI SDK stream. One query per handle.
  const queryStart = performance.now();
  let warmTtftMs: number | undefined;
  let warmText = '';
  let resultMessage: Extract<SDKMessage, { type: 'result' }> | undefined;

  for await (const message of warm.query(PROMPT)) {
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text' && block.text.length > 0) {
          // Timestamp the first assistant text we see.
          warmTtftMs ??= performance.now() - queryStart;
          warmText += block.text;
        }
      }
    } else if (message.type === 'result') {
      resultMessage = message;
    }
  }
  console.log('Assistant:', warmText.trim());
  console.log(`First assistant text after warm.query(): ${fmt(warmTtftMs)}`);

  if (!resultMessage || resultMessage.subtype !== 'success') {
    throw new Error('Warm query did not produce a success result message.');
  }
  console.log('\nWarm query result message (raw SDK fields):');
  console.log(`- total_cost_usd:     $${resultMessage.total_cost_usd.toFixed(4)}`);
  console.log(`- duration_ms:        ${resultMessage.duration_ms}ms`);
  console.log(`- ttft_ms:            ${fmt(resultMessage.ttft_ms)}`);
  console.log(`- time_to_request_ms: ${fmt(resultMessage.time_to_request_ms)}`);
  if ('warm_spare_claimed' in resultMessage) {
    console.log(`- warm_spare_claimed: ${resultMessage.warm_spare_claimed}`);
  }

  // ============================================
  // 3. Side-by-side: where did the latency go?
  // ============================================
  // The cold ttftMs includes subprocess spawn + initialize; the warm
  // time-to-first-token starts at warm.query() because startup() already
  // paid those costs. The warm number should be visibly lower.
  console.log('\n3️⃣  Cold vs warm time-to-first-token:');
  const coldTtft = typeof metadata.ttftMs === 'number' ? metadata.ttftMs : undefined;
  console.log('   ┌──────────────────────────────────────────────┬──────────┐');
  console.log(`   │ Cold ttftMs (includes spawn + handshake)     │ ${fmt(coldTtft).padStart(8)} │`);
  console.log(
    `   │ Warm time-to-first-token (after warm.query)  │ ${fmt(warmTtftMs).padStart(8)} │`
  );
  console.log(
    `   │ startup() handshake (pre-paid, off the path) │ ${fmt(handshakeMs).padStart(8)} │`
  );
  console.log('   └──────────────────────────────────────────────┴──────────┘');
  if (typeof coldTtft === 'number' && typeof warmTtftMs === 'number') {
    const saved = coldTtft - warmTtftMs;
    if (saved > 0) {
      console.log(
        `   ✅ Warm start was ${Math.round(saved)}ms faster to first token ` +
          `(${Math.round((saved / coldTtft) * 100)}% of cold ttftMs)`
      );
    } else {
      // Model-side latency varies run to run; the structural win is that the
      // ~startup() handshake cost above is off the critical path either way.
      console.log(
        `   ⚠️ Warm run was not faster this time (model latency variance); ` +
          `the ${Math.round(handshakeMs)}ms spawn+handshake was still pre-paid.`
      );
    }
  }

  // ============================================
  // 4. Cleanup: discarding an unused warm handle
  // ============================================
  // If you pre-warm speculatively and never use the handle, release the
  // subprocess with close(). (WarmQuery is also AsyncDisposable, so
  // `await using warm = await startup(...)` works on newer runtimes.)
  console.log('\n4️⃣  Discarding an unused warm handle with close()...');
  const unused = await startup({ options: { model: 'haiku', settingSources: [] } });
  unused.close();
  console.log('✅ Unused WarmQuery closed without sending a prompt');
}

main()
  .then(() => {
    console.log('\n✅ Warm start example completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Example failed:', error);
    process.exit(1);
  });
