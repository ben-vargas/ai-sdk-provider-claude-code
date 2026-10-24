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
async function streamChunks(events: unknown[], json = false) {
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
  return chunks;
}
async function collect(events: unknown[], json = false) {
  const chunks = await streamChunks(events, json);
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

describe('ordinary tool input finalization (#179)', () => {
  const toolCall = (chunks: any[], id: string) =>
    chunks.find((c) => c.type === 'tool-call' && c.toolCallId === id);
  const deltasAfterCall = (chunks: any[], id: string) =>
    chunks
      .slice(chunks.indexOf(toolCall(chunks, id)))
      .filter((c) => c.type === 'tool-input-delta' && c.id === id);

  it.each([false, true])(
    'finalizes the complete assistant input over a partial accumulator (JSON mode %s)',
    async (json) => {
      const input = { file_path: '/tmp/a', limit: 5 };
      const chunks = await collect(
        [start('read'), delta('{"file_path":'), assistant('read', input), stop()],
        json
      );
      expect(toolCall(chunks, 'read')?.input).toBe(JSON.stringify(input));
      expect(inputDeltas(chunks, 'read').join('')).toBe(JSON.stringify(input));
      expect(deltasAfterCall(chunks, 'read')).toEqual([]);
    }
  );
  it('finalizes the complete assistant input when the accumulator parses to a different value', async () => {
    const input = { file_path: '/tmp/a', limit: 5 };
    // A dropped middle fragment (',"limit":5') still leaves valid JSON.
    const chunks = await collect([
      start('read'),
      delta('{"file_path":"/tmp/a"'),
      delta('}'),
      assistant('read', input),
      stop(),
    ]);
    expect(toolCall(chunks, 'read')?.input).toBe(JSON.stringify(input));
    expect(inputDeltas(chunks, 'read')).toEqual(['{"file_path":"/tmp/a"', '}']);
    expect(deltasAfterCall(chunks, 'read')).toEqual([]);
  });
  it.each(['{ "file_path" : "/tmp/a" }', '{"file_path":"/tmp/\\u0061"}'])(
    'keeps complete wire input %s byte-for-byte',
    async (wire) => {
      const chunks = await collect([
        start('read'),
        delta(wire),
        assistant('read', JSON.parse(wire)),
        stop(),
      ]);
      expect(toolCall(chunks, 'read')?.input).toBe(wire);
    }
  );
  it('keeps complete wire input whose object keys are ordered differently', async () => {
    const wire = '{ "options": { "b": 2, "a": 1 }, "file_path": "/tmp/a" }';
    const chunks = await collect([
      start('read'),
      delta(wire),
      assistant('read', { file_path: '/tmp/a', options: { a: 1, b: 2 } }),
      stop(),
    ]);
    expect(toolCall(chunks, 'read')?.input).toBe(wire);
  });
  it('finalizes the complete assistant input when array order differs', async () => {
    const input = { paths: ['/b', '/a'] };
    const chunks = await collect([
      start('read'),
      delta('{"paths":["/a","/b"]}'),
      assistant('read', input),
      stop(),
    ]);
    expect(toolCall(chunks, 'read')?.input).toBe(JSON.stringify(input));
  });
  it.each(['hello', 'null', '42', 'true', '{"x":1}'])(
    'keeps wire JSON encoding the pass-through string assistant input %s',
    async (value) => {
      const wire = JSON.stringify(value);
      const chunks = await collect([start('read'), delta(wire), assistant('read', value), stop()]);
      expect(toolCall(chunks, 'read')?.input).toBe(wire);
    }
  );
  it('keeps wire JSON matching a pre-serialized string assistant input', async () => {
    const wire = '{ "x": 1 }';
    const chunks = await collect([
      start('read'),
      delta(wire),
      assistant('read', '{"x":1}'),
      stop(),
    ]);
    expect(toolCall(chunks, 'read')?.input).toBe(wire);
  });
  it('finalizes a non-string assistant input over a wire string of the same text', async () => {
    const chunks = await collect([start('read'), delta('"42"'), assistant('read', 42), stop()]);
    expect(toolCall(chunks, 'read')?.input).toBe('42');
  });
  it('keeps the accumulator when no assistant snapshot precedes block_stop', async () => {
    const chunks = await collect([start('read'), delta('{"file_path":'), stop()]);
    expect(toolCall(chunks, 'read')?.input).toBe('{"file_path":');
  });
});

describe('assistant snapshot after block_stop (#186)', () => {
  const lifecycle = (chunks: any[], id: string) =>
    chunks
      .filter((c) => (c.id ?? c.toolCallId) === id && c.type.startsWith('tool-'))
      .map((c) => c.type);
  const callInput = (chunks: any[], id: string) =>
    chunks.find((c) => c.type === 'tool-call' && c.toolCallId === id)?.input;

  it.each([false, true])(
    'emits no input delta after the call finalized from a partial accumulator (JSON mode %s)',
    async (json) => {
      const chunks = await collect(
        [start('read'), delta('{"file_path":'), stop(), assistant('read', { file_path: '/a' })],
        json
      );
      expect(lifecycle(chunks, 'read')).toEqual([
        'tool-input-start',
        'tool-input-delta',
        'tool-input-end',
        'tool-call',
      ]);
      expect(inputDeltas(chunks, 'read')).toEqual(['{"file_path":']);
      expect(callInput(chunks, 'read')).toBe('{"file_path":');
    }
  );
  it('emits no input delta after the call when the block had no input deltas', async () => {
    const chunks = await collect([start('read'), stop(), assistant('read', { file_path: '/a' })]);
    expect(lifecycle(chunks, 'read')).toEqual(['tool-input-start', 'tool-input-end', 'tool-call']);
    expect(callInput(chunks, 'read')).toBe('');
  });
  it('emits no input delta after closed calls when subagent and root blocks share an index', async () => {
    const sub = (chunk: object) => ({ ...chunk, parent_tool_use_id: 'task' });
    const chunks = await collect([
      start('root'),
      sub(start('child')),
      delta('{"file_path":'),
      sub(delta('{"file_path":')),
      sub(stop()),
      stop(),
      sub(assistant('child', { file_path: '/b' })),
      assistant('root', { file_path: '/a' }),
    ]);
    for (const id of ['root', 'child']) {
      expect(lifecycle(chunks, id)).toEqual([
        'tool-input-start',
        'tool-input-delta',
        'tool-input-end',
        'tool-call',
      ]);
      expect(callInput(chunks, id)).toBe('{"file_path":');
    }
  });
  it('still rejects an oversized snapshot that arrives after block_stop', async () => {
    const chunks = await streamChunks([
      start('read'),
      delta('{"file_path":'),
      stop(),
      assistant('read', { file_path: 'x'.repeat(1_048_576) }),
    ]);
    const errors = chunks.filter((c) => c.type === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].error.message).toMatch(/Tool input exceeds maximum size/);
    expect(inputDeltas(chunks, 'read')).toEqual(['{"file_path":']);
  });
});
