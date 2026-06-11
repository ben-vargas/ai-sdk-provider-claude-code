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
import type { ModelMessage } from 'ai';
import { claudeCode } from '../dist/index.js';

// The provider's post-result drain gives up after 10s; wait slightly longer.
const SUGGESTION_WAIT_MS = 12_000;

function waitFor<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

async function suggestionsEnabled(): Promise<{ answer: string; suggestion: string | null }> {
  console.log('1️⃣ promptSuggestions: true — suggestion delivered post-finish\n');

  // The callback fires after the result message, so capture it via a promise.
  let resolveSuggestion!: (s: string) => void;
  const suggestionPromise = new Promise<string>((resolve) => {
    resolveSuggestion = resolve;
  });

  const model = claudeCode('haiku', {
    promptSuggestions: true,
    onPromptSuggestion: (suggestion) => {
      resolveSuggestion(suggestion);
    },
  });

  // A conversation-shaped first step of a two-step task, so the predicted
  // next prompt ("now do step two") is plausible.
  const result = await generateText({
    model,
    prompt:
      'I am writing a two-line poem about the ocean. ' +
      'Give me ONLY the first line for now. I will ask for the second line next.',
  });

  // The answer prints first; the suggestion arrives after the result message.
  // This console ordering is the documented post-finish delivery in action.
  console.log('Answer (finished first):', result.text.trim());

  const suggestion = await waitFor(suggestionPromise, SUGGESTION_WAIT_MS);
  if (suggestion) {
    console.log('Suggested next prompt (arrived after finish):', suggestion);
  } else {
    console.log('No suggestion delivered within the drain window.');
  }
  return { answer: result.text.trim(), suggestion };
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

async function feedSuggestionBack(firstAnswer: string, suggestion: string): Promise<void> {
  console.log('\n3️⃣ The intended UX loop — feed the suggestion back as the next user message\n');

  // In a chat UI you would render the suggestion as a tappable chip;
  // here we simply send it as the next user turn.
  const messages: ModelMessage[] = [
    {
      role: 'user',
      content:
        'I am writing a two-line poem about the ocean. ' +
        'Give me ONLY the first line for now. I will ask for the second line next.',
    },
    { role: 'assistant', content: firstAnswer },
    { role: 'user', content: suggestion },
  ];

  const result = await generateText({
    model: claudeCode('haiku'),
    messages,
  });
  console.log('User (from suggestion):', suggestion);
  console.log('Assistant:', result.text.trim());
}

async function main() {
  try {
    const { answer, suggestion } = await suggestionsEnabled();
    await suggestionsDisabled();
    if (suggestion) {
      await feedSuggestionBack(answer, suggestion);
    }
  } catch (error) {
    console.error('Error:', error);
    console.log('\nTroubleshooting:');
    console.log('1. Install Claude Code: https://docs.anthropic.com/en/docs/claude-code/overview');
    console.log('2. Authenticate: claude auth login');
    console.log('3. Run check-cli.ts to verify setup');
  }
}

main().catch(console.error);
