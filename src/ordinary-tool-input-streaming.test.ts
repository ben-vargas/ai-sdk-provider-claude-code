import { describe, expect, it, vi } from 'vitest';
import { ClaudeCodeLanguageModel } from './claude-code-language-model.js';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  AbortError: class extends Error {},
}));
import { query } from '@anthropic-ai/claude-agent-sdk';

const event = (event: unknown) => ({ type: 'stream_event', event });
const start = (id: string, index = 0) =>
  event({
    type: 'content_block_start',
    index,
    content_block: { type: 'tool_use', id, name: 'Read', input: {} },
  });
const delta = (partial_json: string, index = 0) =>
  event({
    type: 'content_block_delta',
    index,
    delta: { type: 'input_json_delta', partial_json },
  });
const stop = (index = 0) => event({ type: 'content_block_stop', index });
const assistant = (id: string, input: unknown) => ({
  type: 'assistant',
  uuid: `uuid-${id}`,
  parent_tool_use_id: null,
  message: { content: [{ type: 'tool_use', id, name: 'Read', input }] },
});
const result = {
  type: 'result',
  subtype: 'success',
  session_id: 'tool-delta-test',
  usage: { input_tokens: 1, output_tokens: 1 },
};
const inputDeltas = (chunks: any[], id: string) =>
  chunks.filter((c) => c.type === 'tool-input-delta' && c.id === id).map((c) => c.delta);
async function collect(events: unknown[], json = false) {
  vi.mocked(query).mockReturnValue({
    async *[Symbol.asyncIterator]() {
      yield* events;
      yield { ...result, ...(json && { structured_output: { answer: 42 } }) };
    },
  } as any);
  const model = new ClaudeCodeLanguageModel({
    id: 'sonnet',
    settings: { logger: false },
  });
  const { stream } = await model.doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
    responseFormat: json ? { type: 'json', schema: { type: 'object' } } : { type: 'text' },
  });
  const chunks: any[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  expect(chunks.some((c) => c.type === 'error')).toBe(false);
  return chunks;
}

describe('ordinary tool input deduplication', () => {
  it.each([false, true])(
    'does not resend streamed input when assistant precedes block_stop (JSON mode %s)',
    async (json) => {
      const input = { file_path: '/tmp/a' };
      const chunks = await collect(
        [
          start('read'),
          delta('{"file_path":'),
          delta('"/tmp/a"}'),
          assistant('read', input),
          stop(),
        ],
        json
      );
      expect(inputDeltas(chunks, 'read')).toEqual(['{"file_path":', '"/tmp/a"}']);
      expect(chunks.find((c) => c.type === 'tool-call')?.input).toBe(JSON.stringify(input));
    }
  );
  it.each([false, true])(
    'preserves stop-before-assistant delivery (JSON mode %s)',
    async (json) => {
      const input = { file_path: '/tmp/a' };
      const chunks = await collect(
        [start('read'), delta(JSON.stringify(input)), stop(), assistant('read', input)],
        json
      );
      expect(inputDeltas(chunks, 'read')).toEqual([JSON.stringify(input)]);
    }
  );
  it.each(['{ "file_path" : "/tmp/a" }', '{"file_path":"/tmp/\\u0061"}'])(
    'does not append reserialized JSON after wire input %s',
    async (wire) => {
      const chunks = await collect([
        start('read'),
        delta(wire),
        assistant('read', JSON.parse(wire)),
        stop(),
      ]);
      expect(inputDeltas(chunks, 'read')).toEqual([wire]);
      expect(JSON.parse(chunks.find((c) => c.type === 'tool-call')?.input)).toEqual(
        JSON.parse(wire)
      );
    }
  );
  it('handles repeated complete assistant snapshots without duplicate deltas', async () => {
    const input = { file_path: '/tmp/a' };
    const chunks = await collect([
      start('read'),
      delta(JSON.stringify(input)),
      assistant('read', input),
      assistant('read', input),
      stop(),
    ]);
    expect(inputDeltas(chunks, 'read')).toEqual([JSON.stringify(input)]);
  });
  it('still emits input when only the complete assistant message is available', async () => {
    const input = { file_path: '/tmp/a' };
    const chunks = await collect([assistant('read', input)]);
    expect(inputDeltas(chunks, 'read')).toEqual([JSON.stringify(input)]);
    expect(chunks.find((c) => c.type === 'tool-call')?.input).toBe(JSON.stringify(input));
  });
  it('still emits input when a block starts but has no input deltas', async () => {
    const input = { file_path: '/tmp/a' };
    const chunks = await collect([start('read'), assistant('read', input), stop()]);
    expect(inputDeltas(chunks, 'read')).toEqual([JSON.stringify(input)]);
    expect(chunks.find((c) => c.type === 'tool-call')?.input).toBe(JSON.stringify(input));
  });
  it('keeps streamed input independent for parallel calls', async () => {
    const first = { file_path: '/tmp/a' },
      second = { file_path: '/tmp/b' };
    const chunks = await collect([
      start('a', 0),
      start('b', 1),
      delta(JSON.stringify(first), 0),
      delta(JSON.stringify(second), 1),
      assistant('b', second),
      assistant('a', first),
      stop(1),
      stop(0),
    ]);
    expect(inputDeltas(chunks, 'a')).toEqual([JSON.stringify(first)]);
    expect(inputDeltas(chunks, 'b')).toEqual([JSON.stringify(second)]);
  });
  it('keeps streamed input independent when a block index is reused', async () => {
    const first = { file_path: '/tmp/a' },
      second = { file_path: '/tmp/b' };
    const chunks = await collect([
      start('a'),
      delta(JSON.stringify(first)),
      assistant('a', first),
      stop(),
      start('b'),
      delta(JSON.stringify(second)),
      assistant('b', second),
      stop(),
    ]);
    expect(inputDeltas(chunks, 'a')).toEqual([JSON.stringify(first)]);
    expect(inputDeltas(chunks, 'b')).toEqual([JSON.stringify(second)]);
  });
});
