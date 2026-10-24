import { describe, expect, it, vi } from 'vitest';
import { ClaudeCodeLanguageModel } from './claude-code-language-model.js';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  AbortError: class extends Error {},
}));
import { query } from '@anthropic-ai/claude-agent-sdk';

// Subagent stream events (parent_tool_use_id set) have their own block index
// space, so a root block and a subagent block can share an index (#183).
const SUB = 'toolu_task';
const event = (event: unknown, parent: string | null = null) => ({
  type: 'stream_event',
  parent_tool_use_id: parent,
  event,
});
const start = (id: string, index: number, parent: string | null = null, name = 'Read') =>
  event(
    {
      type: 'content_block_start',
      index,
      content_block: { type: 'tool_use', id, name, input: {} },
    },
    parent
  );
const blockStart = (type: string, index: number, parent: string | null = null) =>
  event({ type: 'content_block_start', index, content_block: { type } }, parent);
const delta = (partial_json: string, index: number, parent: string | null = null) =>
  event(
    { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json } },
    parent
  );
const thinking = (text: string, index: number, parent: string | null = null) =>
  event(
    { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: text } },
    parent
  );
const stop = (index: number, parent: string | null = null) =>
  event({ type: 'content_block_stop', index }, parent);
const result = {
  type: 'result',
  subtype: 'success',
  session_id: 'tool-block-scope-test',
  usage: { input_tokens: 1, output_tokens: 1 },
};
const inputDeltas = (chunks: any[], id: string) =>
  chunks.filter((c) => c.type === 'tool-input-delta' && c.id === id).map((c) => c.delta);
const toolCall = (chunks: any[], id: string) =>
  chunks.find((c) => c.type === 'tool-call' && c.toolCallId === id);
const ids = (chunks: any[], type: string) => chunks.filter((c) => c.type === type).map((c) => c.id);
async function collect(events: unknown[], json = false, settings: Record<string, unknown> = {}) {
  vi.mocked(query).mockReturnValue({
    async *[Symbol.asyncIterator]() {
      yield* events;
      yield { ...result, ...(json && { structured_output: { answer: 42 } }) };
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

describe('stream block tracking is scoped by parent_tool_use_id (#183)', () => {
  it.each([false, true])(
    'keeps root and subagent tool input apart at the same index (JSON mode %s)',
    async (json) => {
      const chunks = await collect(
        [
          start('root', 0),
          start('sub', 0, SUB),
          delta('{"file_path":"/sub"}', 0, SUB),
          delta('{"file_path":"/root"}', 0),
          stop(0, SUB),
          stop(0),
        ],
        json
      );
      expect(inputDeltas(chunks, 'root')).toEqual(['{"file_path":"/root"}']);
      expect(inputDeltas(chunks, 'sub')).toEqual(['{"file_path":"/sub"}']);
      expect(toolCall(chunks, 'root')?.input).toBe('{"file_path":"/root"}');
      expect(toolCall(chunks, 'sub')?.input).toBe('{"file_path":"/sub"}');
    }
  );

  it.each([false, true])(
    'a root block at a subagent index does not steal subagent fragments (JSON mode %s)',
    async (json) => {
      const chunks = await collect(
        [
          start('sub', 0, SUB),
          delta('{"file_path":', 0, SUB),
          start('root', 0),
          delta('"/sub"}', 0, SUB),
          delta('{"file_path":"/root"}', 0),
          stop(0),
          stop(0, SUB),
        ],
        json
      );
      expect(inputDeltas(chunks, 'sub')).toEqual(['{"file_path":', '"/sub"}']);
      expect(inputDeltas(chunks, 'root')).toEqual(['{"file_path":"/root"}']);
      expect(toolCall(chunks, 'sub')?.input).toBe('{"file_path":"/sub"}');
      expect(toolCall(chunks, 'root')?.input).toBe('{"file_path":"/root"}');
    }
  );

  it('a subagent stop does not close a root tool block at the same index', async () => {
    const chunks = await collect([
      start('root', 0),
      start('sub', 0, SUB),
      stop(0, SUB),
      delta('{"file_path":"/root"}', 0),
      stop(0),
    ]);
    expect(inputDeltas(chunks, 'root')).toEqual(['{"file_path":"/root"}']);
    expect(toolCall(chunks, 'root')?.input).toBe('{"file_path":"/root"}');
    const types = chunks.filter((c) => c.id === 'root').map((c) => c.type);
    expect(types).toEqual(['tool-input-start', 'tool-input-delta', 'tool-input-end']);
  });

  it('a root tool block does not take a subagent server tool block at the same index', async () => {
    const chunks = await collect([
      blockStart('server_tool_use', 0, SUB),
      start('root', 0),
      delta('{"query":"sub"}', 0, SUB),
      stop(0, SUB),
      delta('{"file_path":"/root"}', 0),
      stop(0),
    ]);
    expect(inputDeltas(chunks, 'root')).toEqual(['{"file_path":"/root"}']);
    expect(toolCall(chunks, 'root')?.input).toBe('{"file_path":"/root"}');
  });

  it('a subagent tool block does not hide an untracked root delta in JSON mode', async () => {
    const chunks = await collect(
      [start('sub', 0, SUB), delta('{"answer":', 0), delta('{"file_path":"/sub"}', 0, SUB)],
      true,
      { streamStructuredOutput: true }
    );
    expect(inputDeltas(chunks, 'sub')).toEqual(['{"file_path":"/sub"}']);
    expect(chunks.filter((c) => c.type === 'text-delta').map((c) => c.delta)[0]).toBe('{"answer":');
  });

  it('a subagent non-text tool block does not hide an untracked root delta in JSON mode', async () => {
    const chunks = await collect(
      [blockStart('server_tool_use', 0, SUB), delta('{"answer":', 0)],
      true,
      { streamStructuredOutput: true }
    );
    expect(chunks.filter((c) => c.type === 'text-delta').map((c) => c.delta)[0]).toBe('{"answer":');
  });

  it('closes root and subagent text blocks at the same index independently', async () => {
    const chunks = await collect([
      blockStart('text', 0),
      blockStart('text', 0, SUB),
      stop(0, SUB),
      stop(0),
    ]);
    const started = ids(chunks, 'text-start');
    expect(started).toHaveLength(2);
    expect(ids(chunks, 'text-end')).toEqual([started[1], started[0]]);
  });

  it('routes and closes root and subagent reasoning at the same index independently', async () => {
    const chunks = await collect([
      blockStart('thinking', 0),
      blockStart('thinking', 0, SUB),
      thinking('sub', 0, SUB),
      thinking('root', 0),
      stop(0),
      stop(0, SUB),
    ]);
    const [root, sub] = ids(chunks, 'reasoning-start');
    const reasoning = chunks.filter((c) => c.type === 'reasoning-delta');
    expect(reasoning.map((c) => [c.id, c.delta])).toEqual([
      [sub, 'sub'],
      [root, 'root'],
    ]);
    expect(ids(chunks, 'reasoning-end')).toEqual([root, sub]);
  });

  it('keeps distinct subagents at the same index apart', async () => {
    const chunks = await collect([
      start('a', 0, 'toolu_task_a'),
      start('b', 0, 'toolu_task_b'),
      delta('{"file_path":"/a"}', 0, 'toolu_task_a'),
      delta('{"file_path":"/b"}', 0, 'toolu_task_b'),
      stop(0, 'toolu_task_a'),
      stop(0, 'toolu_task_b'),
    ]);
    expect(toolCall(chunks, 'a')?.input).toBe('{"file_path":"/a"}');
    expect(toolCall(chunks, 'b')?.input).toBe('{"file_path":"/b"}');
  });
});
