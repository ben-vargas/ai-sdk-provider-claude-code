/**
 * Prompt suggestions example for Claude Code AI SDK Provider
 *
 * Demonstrates the onPromptSuggestion callback (requires promptSuggestions: true).
 * When enabled, the Claude Agent SDK predicts the user's likely next prompt and
 * emits it as a `prompt_suggestion` message.
 *
 * Why a callback instead of providerMetadata? The suggestion arrives AFTER the
 * `result` message — i.e. after the AI SDK response has already finished — so it
 * cannot be attached to the finish event. The provider drains the SDK stream
 * post-finish to deliver it:
 * - The drain is bounded: it stops as soon as the first suggestion arrives,
 *   and a 10s timeout tears down the subprocess if none is emitted.
 * - The SDK emits at most ONE prompt_suggestion per turn.
 *
 * Because delivery is post-finish, your callback may fire after generateText()
 * resolves. This example bridges that gap with a promise + bounded race.
 *
 * Usage: npx tsx examples/prompt-suggestions.ts
 */

import { generateText } from 'ai';
import { claudeCode } from '../dist/index.js';

// generateText() already awaits the provider's bounded post-result drain (10s)
// when onPromptSuggestion is set, so by the time it resolves the callback has
// either fired or never will. This just settles the resolved-or-not promise
// without waiting a second full window.
function settled<T>(promise: Promise<T>): Promise<T | null> {
  return Promise.race([promise, Promise.resolve(null)]);
}

async function suggestionsEnabled(): Promise<{
  sessionId: string | undefined;
  suggestion: string | null;
}> {
  console.log('1️⃣ promptSuggestions: true — suggestion delivered post-finish\n');

  // The CLI suppresses prompt suggestions on the FIRST turn of a fresh
  // session, so seed a session with an ordinary request first and then ask
  // for suggestions on the resumed second turn.
  const seed = await generateText({
    model: claudeCode('haiku'),
    prompt:
      'I am writing a two-line poem about the ocean. ' +
      'Give me ONLY the first line for now. I will ask for the second line next.',
  });
  const sessionId = (seed.providerMetadata?.['claude-code'] as { sessionId?: string } | undefined)
    ?.sessionId;
  console.log('Seeded session:', sessionId ?? '(no session id?)');

  // The callback fires after the result message, so capture it via a promise.
  let resolveSuggestion!: (s: string) => void;
  const suggestionPromise = new Promise<string>((resolve) => {
    resolveSuggestion = resolve;
  });

  const model = claudeCode('haiku', {
    resume: sessionId,
    promptSuggestions: true,
    onPromptSuggestion: (suggestion) => {
      resolveSuggestion(suggestion);
    },
  });

  // Second turn of the two-step task, so the predicted next prompt
  // ("now do step two" / "ask for the second line") is plausible.
  const result = await generateText({
    model,
    prompt: 'Nice. Now remind me: what should I ask you for next?',
  });

  // The answer prints first; the suggestion arrives after the result message.
  // This console ordering is the documented post-finish delivery in action.
  console.log('Answer (finished first):', result.text.trim());

  const suggestion = await settled(suggestionPromise);
  if (suggestion) {
    console.log('Suggested next prompt (arrived after finish):', suggestion);
  } else {
    console.log(
      'No suggestion delivered within the drain window.\n' +
        '(Delivery depends on CLI-side heuristics and may not occur on every\n' +
        'turn; the feedback-loop demo below will use a simulated suggestion.)'
    );
  }
  // Return the SESSION (not the turn text): the feedback loop resumes the real
  // conversation so the history stays coherent regardless of which turn the
  // suggestion came from.
  return { sessionId, suggestion };
}

async function suggestionsDisabled(): Promise<void> {
  console.log('\n2️⃣ promptSuggestions unset — callback never fires\n');

  let fired = false;
  const model = claudeCode('haiku', {
    // promptSuggestions intentionally NOT set
    onPromptSuggestion: () => {
      fired = true;
    },
  });

  const result = await generateText({
    model,
    prompt: 'Say "hello" and nothing else.',
  });
  console.log('Answer:', result.text.trim());

  // Short grace period: without promptSuggestions: true the CLI never emits
  // a prompt_suggestion message, so the callback stays silent.
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  console.log(
    fired
      ? 'Unexpected: suggestion callback fired without promptSuggestions: true'
      : 'No suggestion delivered (as expected without promptSuggestions: true)'
  );
}

async function feedSuggestionBack(
  sessionId: string | undefined,
  suggestion: string
): Promise<void> {
  console.log('\n3️⃣ The intended UX loop — feed the suggestion back as the next user message\n');

  // In a chat UI you would render the suggestion as a tappable chip; here we
  // send it as the next user turn. Resuming the seeded session keeps the
  // conversation coherent (the model already has the first line in context)
  // instead of hand-reconstructing a transcript.
  const result = await generateText({
    model: claudeCode('haiku', sessionId ? { resume: sessionId } : {}),
    prompt: suggestion,
  });
  console.log('User (from suggestion):', suggestion);
  console.log('Assistant:', result.text.trim());
}

async function main() {
  try {
    const { sessionId, suggestion } = await suggestionsEnabled();
    await suggestionsDisabled();
    // Demonstrate the feedback loop either way: with the real suggestion
    // when one was delivered, otherwise with a clearly-labeled simulated one
    // (what the CLI typically predicts for this two-step task).
    if (!suggestion) {
      console.log('\n(Using a simulated suggestion for the loop demo below.)');
    }
    await feedSuggestionBack(sessionId, suggestion ?? 'Now give me the second line of the poem.');
  } catch (error) {
    console.error('Error:', error);
    console.log('\nTroubleshooting:');
    console.log('1. Install Claude Code: https://docs.anthropic.com/en/docs/claude-code/overview');
    console.log('2. Authenticate: claude auth login');
    console.log('3. Run check-cli.ts to verify setup');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
