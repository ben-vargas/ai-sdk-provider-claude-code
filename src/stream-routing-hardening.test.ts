import { describe, expect, it, vi } from 'vitest';
import { ClaudeCodeLanguageModel } from './claude-code-language-model.js';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  AbortError: class extends Error {},
}));
import { query } from '@anthropic-ai/claude-agent-sdk';

// doStream routing and retraction hardening (#193-#197).
const SUB = 'toolu_task';
const event = (event: unknown, parent: string | null = null, uuid?: string) => ({
  type: 'stream_event',
  parent_tool_use_id: parent,
  ...(uuid && { uuid }),
  event,
});
const start = (id: string, index: number, name = 'Read', uuid?: string) =>
  event(
    {
      type: 'content_block_start',
      index,
      content_block: { type: 'tool_use', id, name, input: {} },
    },
    null,
    uuid
  );
const blockStart = (type: string, index: number, parent: string | null = null) =>
  event({ type: 'content_block_start', index, content_block: { type } }, parent);
const delta = (partial_json: string, index: number) =>
  event({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json } });
const text = (value: string, index: number, parent: string | null = null) =>
  event({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: value } }, parent);
const thinking = (value: string, index: number, parent: string | null = null) =>
  event(
    { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: value } },
    parent
  );
const stop = (index: number, parent: string | null = null) =>
  event({ type: 'content_block_stop', index }, parent);
const assistant = (uuid: string, content: unknown[], supersedes?: string[]) => ({
  type: 'assistant',
  uuid,
  parent_tool_use_id: null,
  ...(supersedes && { supersedes }),
  message: { content },
});
const toolUse = (id: string, input: unknown, name = 'Read') => ({
  type: 'tool_use',
  id,
  name,
  input,
});
const toolResult = (id: string) => ({
  type: 'user',
  parent_tool_use_id: null,
  message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
});
const result = {
  type: 'result',
  subtype: 'success',
  session_id: 'stream-routing-hardening-test',
  usage: { input_tokens: 1, output_tokens: 1 },
};
const ofId = (chunks: any[], id: string) =>
  chunks.filter((c) => c.id === id || c.toolCallId === id).map((c) => c.type);
const ids = (chunks: any[], type: string) => chunks.filter((c) => c.type === type).map((c) => c.id);
const deltasOf = (chunks: any[], type: string) =>
  chunks.filter((c) => c.type === type).map((c) => [c.id, c.delta]);
async function collect(events: unknown[], json = false, settings: Record<string, unknown> = {}) {
  vi.mocked(query).mockReturnValue({
    async *[Symbol.asyncIterator]() {
      yield* events;
      yield result;
    },
  } as any);
  const model = new ClaudeCodeLanguageModel({
    id: 'sonnet',
    settings: { logger: false, ...settings },
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
// JSON mode, result without structured_output: the recovered object text.
const recoveredJson = (chunks: any[]) =>
  chunks.filter((c) => c.type === 'text-delta').map((c) => c.delta);

describe('text_delta routes by block (#193)', () => {
  it('routes a root delta to the root part while a subagent text block is open', async () => {
    const chunks = await collect([
      blockStart('text', 0),
      blockStart('text', 1, SUB),
      text('root', 0),
      text('sub', 1, SUB),
      stop(1, SUB),
      text(' more', 0),
      stop(0),
    ]);
    const [root, sub] = ids(chunks, 'text-start');
    expect(deltasOf(chunks, 'text-delta')).toEqual([
      [root, 'root'],
      [sub, 'sub'],
      [root, ' more'],
    ]);
    expect(ids(chunks, 'text-end')).toEqual([sub, root]);
  });

  it('keeps routing untracked deltas to the current text part', async () => {
    const chunks = await collect([text('a', 0), text('b', 0), blockStart('text', 1), text('c', 7)]);
    const [first, second] = ids(chunks, 'text-start');
    expect(deltasOf(chunks, 'text-delta')).toEqual([
      [first, 'a'],
      [first, 'b'],
      [second, 'c'],
    ]);
  });
});

describe('untracked thinking_delta stays in its scope (#194)', () => {
  it('does not route a subagent delta to the root reasoning part', async () => {
    const chunks = await collect([blockStart('thinking', 0), thinking('sub', 1, SUB), stop(0)]);
    expect(deltasOf(chunks, 'reasoning-delta')).toEqual([]);
  });

  it('falls back to the current reasoning part of the same scope', async () => {
    const chunks = await collect([
      blockStart('thinking', 0, SUB),
      blockStart('thinking', 0),
      thinking('sub', 3, SUB),
      thinking('root', 4),
      stop(0),
      stop(0, SUB),
    ]);
    const [sub, root] = ids(chunks, 'reasoning-start');
    expect(deltasOf(chunks, 'reasoning-delta')).toEqual([
      [sub, 'sub'],
      [root, 'root'],
    ]);
  });
});

describe('retracted StructuredOutput candidates stay retracted (#195)', () => {
  it('a late fragment on the retracted block does not resurrect the candidate', async () => {
    const chunks = await collect(
      [
        start('so', 0, 'StructuredOutput', 'u'),
        delta('{"stale":', 0),
        assistant('r', [{ type: 'text', text: '{"answer":1}' }], ['u']),
        delta('{"late":true}', 0),
        stop(0),
      ],
      true
    );
    expect(recoveredJson(chunks)).toEqual(['{"answer":1}']);
  });

  it('a replayed superseded StructuredOutput call is not recovered', async () => {
    const superseded = assistant('u', [toolUse('so', { late: true }, 'StructuredOutput')]);
    const chunks = await collect(
      [superseded, assistant('r', [{ type: 'text', text: '{"answer":1}' }], ['u']), superseded],
      true
    );
    expect(recoveredJson(chunks)).toEqual(['{"answer":1}']);
  });
});

describe('raw input_json_delta respects the tool lifecycle (#196)', () => {
  it('drops a fragment that arrives after the tool result', async () => {
    const chunks = await collect([
      start('a', 0),
      delta('{"x":', 0),
      toolResult('a'),
      delta('1}', 0),
      stop(0),
    ]);
    expect(ofId(chunks, 'a')).toEqual([
      'tool-input-start',
      'tool-input-delta',
      'tool-input-end',
      'tool-call',
      'tool-result',
    ]);
  });

  it('drops fragments from a block replayed after its stop', async () => {
    const chunks = await collect([
      start('a', 0),
      delta('{"x":1}', 0),
      stop(0),
      start('a', 0),
      delta('{"y":2}', 0),
      stop(0),
    ]);
    expect(ofId(chunks, 'a')).toEqual([
      'tool-input-start',
      'tool-input-delta',
      'tool-input-end',
      'tool-call',
    ]);
    expect(chunks.find((c) => c.type === 'tool-call')?.input).toBe('{"x":1}');
  });
});

describe('retracted tool uses are not re-opened (#197)', () => {
  const superseding = assistant('r', [{ type: 'text', text: 'replacement' }], ['u']);

  it('skips a replayed assistant tool_use for a retracted call', async () => {
    const superseded = assistant('u', [toolUse('a', { x: 1 })]);
    const chunks = await collect([superseded, superseding, superseded]);
    expect(ofId(chunks, 'a')).toEqual(['tool-input-start', 'tool-input-delta', 'tool-input-end']);
  });

  it('skips a replayed content_block_start for a retracted call', async () => {
    const chunks = await collect([
      assistant('u', [toolUse('a', { x: 1 })]),
      superseding,
      start('a', 0),
      delta('{"x":2}', 0),
      stop(0),
    ]);
    expect(ofId(chunks, 'a')).toEqual(['tool-input-start', 'tool-input-delta', 'tool-input-end']);
  });

  it('absorbs a replayed retracted block in JSON mode instead of treating it as output', async () => {
    const chunks = await collect(
      [
        assistant('u', [toolUse('a', { x: 1 })]),
        assistant('r', [{ type: 'text', text: '{"answer":1}' }], ['u']),
        start('a', 0),
        delta('{"x":2}', 0),
        stop(0),
      ],
      true,
      { streamStructuredOutput: true }
    );
    expect(ofId(chunks, 'a')).toEqual(['tool-input-start', 'tool-input-delta', 'tool-input-end']);
    expect(recoveredJson(chunks)).toEqual(['{"answer":1}']);
  });
});
