import { randomUUID } from 'node:crypto';
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeCodeLanguageModel } from './claude-code-language-model.js';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));
const SESSION = randomUUID();
const PENDING = randomUUID();
const native = (frame: Record<string, unknown>) => frame as unknown as SDKMessage;
type Fault =
  | 'throw'
  | 'eof'
  | 'truncation'
  | 'before-result'
  | 'truncation-before-result'
  | 'suggestion';

function script(fault: Fault) {
  vi.mocked(query).mockImplementation(({ prompt }) => {
    if (typeof prompt === 'string') throw new Error('expected streaming input');
    const input = prompt[Symbol.asyncIterator]();
    const messages = (async function* () {
      const first = await input.next();
      if (first.done) throw new Error('missing initial SDK prompt');
      const initial = first.value;
      if (fault === 'suggestion') {
        void input.next();
        await Promise.resolve();
      } else {
        const injected = await input.next();
        if (injected.done || injected.value.uuid !== PENDING)
          throw new Error('injected UUID missing');
      }
      if (fault === 'before-result') throw new Error('transport interrupted');
      if (fault === 'truncation' || fault === 'truncation-before-result') {
        yield native({
          type: 'assistant',
          parent_tool_use_id: null,
          uuid: randomUUID(),
          session_id: SESSION,
          message: {
            id: 'fixture',
            type: 'message',
            role: 'assistant',
            model: 'sonnet',
            content: [{ type: 'text', text: 'x'.repeat(600) }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 11, output_tokens: 5 },
          },
        });
      }
      if (fault === 'truncation-before-result')
        throw new SyntaxError('Unexpected end of JSON input');
      yield native({
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: SESSION,
        user_message_uuid: initial.uuid,
        user_message_uuids: [initial.uuid],
        usage: { input_tokens: 11, output_tokens: 5 },
        modelUsage: {},
        total_cost_usd: 0.01,
      });
      if (fault === 'eof') return;
      if (fault === 'suggestion') {
        yield native({ type: 'prompt_suggestion', suggestion: 'next', session_id: SESSION });
        return;
      }
      if (fault === 'truncation') throw new SyntaxError('Unexpected end of JSON input');
      throw new Error('transport interrupted');
    })();
    return Object.assign(messages, { close: vi.fn() }) as unknown as Query;
  });
}

async function parts(fault: Fault, optIn = true, onPromptSuggestion?: (text: string) => void) {
  script(fault);
  const model = new ClaudeCodeLanguageModel({
    id: 'sonnet',
    settings: {
      logger: false,
      streamingInput: 'always',
      continueInjectedTurns: optIn,
      onStreamStart: (injector) => {
        if (fault === 'suggestion') injector.close();
        else injector.inject('pending', undefined, { uuid: PENDING });
      },
      ...(onPromptSuggestion ? { onPromptSuggestion } : {}),
    },
  });
  const response = await model.doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'start' }] }],
  });
  const reader = response.stream.getReader();
  const out = [];
  for (;;) {
    const next = await reader.read();
    if (next.done) return out;
    out.push(next.value);
  }
}

beforeEach(() => vi.clearAllMocks());
describe('injected continuation known usage on failure', () => {
  for (const fault of ['throw', 'eof', 'truncation'] as const) {
    it(`keeps one error finish with confirmed usage on ${fault}`, async () => {
      const out = await parts(fault);
      const finishes = out.filter((part) => part.type === 'finish');
      expect(finishes).toHaveLength(1);
      expect(finishes[0]).toMatchObject({
        finishReason: { unified: 'error' },
        usage: { inputTokens: { total: 11 }, outputTokens: { total: 5 } },
        providerMetadata: { 'claude-code': { partial: true, costUsd: 0.01 } },
      });
      expect(out.filter((part) => part.type === 'error')).toHaveLength(1);
    });
  }
  it('keeps pre-result truncation recoverable while injected messages remain pending', async () => {
    const out = await parts('truncation-before-result');
    expect(out.filter((part) => part.type === 'finish')).toEqual([]);
    expect(out.filter((part) => part.type === 'error')).toHaveLength(1);
  });
  it('does not invent usage without a result or change the opt-out path', async () => {
    expect((await parts('before-result')).filter((part) => part.type === 'finish')).toEqual([]);
    const legacy = await parts('throw', false);
    expect(legacy.filter((part) => part.type === 'finish')).toHaveLength(1);
    expect(legacy.filter((part) => part.type === 'error')).toEqual([]);
    expect(legacy.find((part) => part.type === 'finish')?.finishReason.unified).toBe('stop');
  });
  it('does not emit a second finish when a post-finish callback throws', async () => {
    const suggestion = vi.fn(() => {
      throw new Error('callback failed');
    });
    const out = await parts('suggestion', true, suggestion);
    expect(out.filter((part) => part.type === 'finish')).toHaveLength(1);
    await vi.waitFor(() => expect(suggestion).toHaveBeenCalledOnce());
  });
});

it('rejects an opt-in stream without the tracked injection callback before spawning SDK IO', async () => {
  const model = new ClaudeCodeLanguageModel({
    id: 'sonnet',
    settings: { continueInjectedTurns: true, streamingInput: 'always' },
  });
  await expect(
    model.doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'start' }] }] })
  ).rejects.toThrow('requires onStreamStart');
  expect(query).not.toHaveBeenCalled();
});

it('notifies interruption synchronously before rejecting queued delivery callbacks', async () => {
  const order: string[] = [];
  vi.mocked(query).mockImplementation(({ prompt }) => {
    if (typeof prompt === 'string') throw new Error('expected streaming input');
    const input = prompt[Symbol.asyncIterator]();
    const messages = (async function* () {
      await input.next();
      // Enter onStreamStart, leaving the second injection queued.
      await input.next();
      yield native({ type: 'system', subtype: 'init', session_id: SESSION });
      throw new Error('transport interrupted');
    })();
    return Object.assign(messages, { close: vi.fn() }) as unknown as Query;
  });
  const model = new ClaudeCodeLanguageModel({
    id: 'sonnet',
    settings: {
      logger: false,
      streamingInput: 'always',
      continueInjectedTurns: true,
      onStreamStart: (injector) => {
        injector.inject('first');
        injector.inject('queued', (ok) => {
          if (!ok) order.push('rejected');
        });
      },
      onStreamEnd: (reason) => {
        order.push(reason);
      },
    },
  });
  const result = await model.doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'start' }] }],
  });
  const reader = result.stream.getReader();
  while (!(await reader.read()).done) {
    /* consume error parts */
  }
  await vi.waitFor(() => expect(order).toEqual(['interrupted', 'rejected']));
});
