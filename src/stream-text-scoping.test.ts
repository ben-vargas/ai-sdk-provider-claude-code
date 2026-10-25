import { describe, expect, it, vi } from 'vitest';
import { streamText } from 'ai';
import { ClaudeCodeLanguageModel } from './claude-code-language-model.js';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  AbortError: class extends Error {},
}));
import { query } from '@anthropic-ai/claude-agent-sdk';

// doStream text accounting, text-part closing, and recovery are scoped by
// parent_tool_use_id (#200, #201, #202), and recovery joins the root's blocks of
// the turn (#202); schema-less JSON falls back to the buffered text (#203).
const SUB = 'toolu_task';
const event = (event: unknown, parent: string | null = null) => ({
  type: 'stream_event',
  parent_tool_use_id: parent,
  event,
});
const blockStart = (type: string, index: number, parent: string | null = null, extra = {}) =>
  event({ type: 'content_block_start', index, content_block: { type, ...extra } }, parent);
const toolStart = (id: string, index: number, parent: string | null = null, name = 'Read') =>
  blockStart('tool_use', index, parent, { id, name, input: {} });
const text = (value: string, index: number, parent: string | null = null) =>
  event({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: value } }, parent);
const thinking = (value: string, index: number, parent: string | null = null) =>
  event(
    { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: value } },
    parent
  );
const json = (partial_json: string, index: number, parent: string | null = null) =>
  event(
    { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json } },
    parent
  );
const stop = (index: number, parent: string | null = null) =>
  event({ type: 'content_block_stop', index }, parent);
const assistant = (content: unknown[], parent: string | null = null) => ({
  type: 'assistant',
  parent_tool_use_id: parent,
  message: { content },
});
const textMessage = (value: string, parent: string | null = null) =>
  assistant([{ type: 'text', text: value }], parent);
const toolMessage = (id: string, input: unknown, parent: string | null = null, name = 'Read') =>
  assistant([{ type: 'tool_use', id, name, input }], parent);
const toolResult = (id: string, parent: string | null = null) => ({
  type: 'user',
  parent_tool_use_id: parent,
  message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
});
const result = (extra = {}) => ({
  type: 'result',
  subtype: 'success',
  session_id: 'stream-text-scoping-test',
  usage: { input_tokens: 1, output_tokens: 1 },
  ...extra,
});
// A background subagent launched from the root; its frames carry SUB.
const launchSubagent = () => {
  const input = { description: 'child', prompt: 'child', run_in_background: true };
  return [
    toolStart(SUB, 0, null, 'Agent'),
    json(JSON.stringify(input), 0),
    toolMessage(SUB, input, null, 'Agent'),
    stop(0),
    toolResult(SUB),
  ];
};
// A finished subagent tool call, so its tool result can arrive later.
const subagentRead = [
  toolStart('read', 0, SUB),
  json('{}', 0, SUB),
  toolMessage('read', {}, SUB),
  stop(0, SUB),
];

const schemaFormat = {
  type: 'json',
  schema: { type: 'object', properties: { answer: { type: 'number' } } },
} as const;
const mockQuery = (frames: unknown[]) =>
  vi.mocked(query).mockReturnValue({
    async *[Symbol.asyncIterator]() {
      yield* frames;
    },
  } as any);
const model = () =>
  new ClaudeCodeLanguageModel({
    id: 'sonnet',
    settings: { logger: false, sdkOptions: { forwardSubagentText: true } },
  });
async function collect(
  events: unknown[],
  responseFormat: any = { type: 'text' },
  final: unknown = result()
) {
  mockQuery([...events, final]);
  const { stream } = await model().doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
    responseFormat,
  });
  const chunks: any[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}
const body = (chunks: any[]) =>
  chunks
    .filter((c) => c.type === 'text-delta')
    .map((c) => c.delta)
    .join('');
const ids = (chunks: any[], type: string) => chunks.filter((c) => c.type === type).map((c) => c.id);
const textOf = (chunks: any[], id: string) =>
  chunks
    .filter((c) => c.type === 'text-delta' && c.id === id)
    .map((c) => c.delta)
    .join('');

describe('text dedup is tracked per scope (#200)', () => {
  it.each([false, true])(
    'a subagent assistant message does not re-emit root text (stop first: %s)',
    async (stopFirst) => {
      const subEnd = [textMessage('x', SUB), stop(0, SUB)];
      const rootEnd = [textMessage('ROOT'), stop(0)];
      if (stopFirst) {
        subEnd.reverse();
        rootEnd.reverse();
      }
      const chunks = await collect([
        ...launchSubagent(),
        blockStart('text', 0),
        text('ROOT', 0),
        blockStart('text', 0, SUB),
        text('x', 0, SUB),
        ...subEnd,
        ...rootEnd,
      ]);
      expect(body(chunks)).toBe('ROOTx');
    }
  );

  it('a subagent tool result does not reset the root text still streaming', async () => {
    const chunks = await collect([
      ...launchSubagent(),
      ...subagentRead,
      blockStart('text', 0),
      text('HEL', 0),
      toolResult('read', SUB),
      text('LO', 0),
      textMessage('HELLO'),
      stop(0),
    ]);
    expect(body(chunks)).toBe('HELLO');
    // The root text stays one part: the subagent's tool result does not close it.
    expect(ids(chunks, 'text-start')).toHaveLength(1);
  });

  it('a root tool result still starts a fresh root turn', async () => {
    const chunks = await collect([
      blockStart('text', 0),
      text('Before', 0),
      textMessage('Before'),
      stop(0),
      toolStart('a', 1),
      json('{}', 1),
      toolMessage('a', {}),
      stop(1),
      toolResult('a'),
      blockStart('text', 0),
      text('After', 0),
      textMessage('After'),
      stop(0),
    ]);
    expect(body(chunks)).toBe('BeforeAfter');
  });

  it('streamText returns each scope text once', async () => {
    mockQuery([
      ...launchSubagent(),
      ...subagentRead,
      blockStart('text', 0),
      text('ROOT', 0),
      blockStart('text', 0, SUB),
      text('x', 0, SUB),
      textMessage('x', SUB),
      stop(0, SUB),
      toolResult('read', SUB),
      text('!', 0),
      textMessage('ROOT!'),
      stop(0),
      result(),
    ]);
    const response = streamText({ model: model(), prompt: 'test' });
    // streamText joins text by part: the root part ('ROOT!'), then the subagent's.
    expect(await response.text).toBe('ROOT!x');
  });
});

describe('text parts are closed only by their own scope (#201)', () => {
  it('a subagent thinking start does not close or unmap the root text part', async () => {
    const chunks = await collect([
      ...launchSubagent(),
      blockStart('text', 0),
      text('A', 0),
      blockStart('thinking', 0, SUB),
      thinking('think', 0, SUB),
      assistant([{ type: 'thinking', thinking: 'think', signature: 'sig' }], SUB),
      stop(0, SUB),
      blockStart('text', 1, SUB),
      text('b', 1, SUB),
      text('Z', 0),
      textMessage('b', SUB),
      stop(1, SUB),
      textMessage('AZ'),
      stop(0),
    ]);
    const [root, sub] = ids(chunks, 'text-start');
    expect(textOf(chunks, root)).toBe('AZ');
    expect(textOf(chunks, sub)).toBe('b');
    expect(ids(chunks, 'text-end')).toEqual([sub, root]);
  });

  it('a subagent tool start does not close the root text part', async () => {
    const chunks = await collect([
      ...launchSubagent(),
      blockStart('text', 0),
      text('A', 0),
      toolStart('read', 0, SUB),
      text('Z', 0),
      json('{}', 0, SUB),
      toolMessage('read', {}, SUB),
      stop(0, SUB),
      textMessage('AZ'),
      stop(0),
    ]);
    const [root] = ids(chunks, 'text-start');
    expect(ids(chunks, 'text-start')).toHaveLength(1);
    expect(textOf(chunks, root)).toBe('AZ');
  });

  it('a root thinking start still closes the open root text part', async () => {
    const chunks = await collect([text('A', 5), blockStart('thinking', 1), text('B', 6)]);
    const [first, second] = ids(chunks, 'text-start');
    expect(chunks.map((c) => c.type).indexOf('reasoning-start')).toBeGreaterThan(
      chunks.findIndex((c) => c.type === 'text-end' && c.id === first)
    );
    expect(textOf(chunks, first)).toBe('A');
    expect(textOf(chunks, second)).toBe('B');
  });
});

describe('missing structured_output recovery uses root text only (#202)', () => {
  it('does not recover a subagent answer as the root answer', async () => {
    const chunks = await collect(
      [
        ...launchSubagent(),
        blockStart('text', 0),
        text('{"answer":42}', 0),
        textMessage('{"answer":42}'),
        stop(0),
        blockStart('text', 0, SUB),
        text('{"answer":7}', 0, SUB),
        textMessage('{"answer":7}', SUB),
        stop(0, SUB),
      ],
      schemaFormat
    );
    expect(chunks.filter((c) => c.type === 'error')).toEqual([]);
    expect(body(chunks)).toBe('{"answer":42}');
  });

  it('a subagent tool result does not erase the root prose', async () => {
    const chunks = await collect(
      [
        ...launchSubagent(),
        ...subagentRead,
        blockStart('text', 0),
        text('{"answer":42}', 0),
        textMessage('{"answer":42}'),
        stop(0),
        toolResult('read', SUB),
      ],
      schemaFormat
    );
    expect(chunks.filter((c) => c.type === 'error')).toEqual([]);
    expect(body(chunks)).toBe('{"answer":42}');
  });
});

describe('doStream recovery joins the root blocks of the turn (#202)', () => {
  const rootBlock = (value: string, index = 0) => [
    blockStart('text', index),
    text(value, index),
    textMessage(value),
    stop(index),
  ];

  it('recovers JSON split across two root text blocks', async () => {
    const chunks = await collect(
      [...rootBlock('{"answer":'), ...rootBlock('42}', 1)],
      schemaFormat
    );
    expect(chunks.filter((c) => c.type === 'error')).toEqual([]);
    expect(body(chunks)).toBe('{"answer":42}');
  });

  it('still recovers JSON from the last block after a prose block', async () => {
    const chunks = await collect(
      [...rootBlock('Here is the answer:'), ...rootBlock('{"answer":42}', 1)],
      schemaFormat
    );
    expect(body(chunks)).toBe('{"answer":42}');
  });

  it('still discards root prose from before a tool call', async () => {
    const chunks = await collect(
      [
        ...rootBlock('{"answer":'),
        toolStart('a', 1),
        json('{}', 1),
        toolMessage('a', {}),
        stop(1),
        toolResult('a'),
        ...rootBlock('42}'),
      ],
      schemaFormat
    );
    expect(chunks.find((c) => c.type === 'error')?.error.message).toContain('structured_output');
  });
});

describe('doGenerate recovery uses root text only (#202)', () => {
  async function generate(events: unknown[]) {
    mockQuery([...events, result()]);
    return model().doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
      responseFormat: schemaFormat,
    });
  }
  const fenced = (value: string) => '```json\n' + value + '\n```';

  it('does not recover a subagent answer as the root answer', async () => {
    const response = await generate([
      ...launchSubagent(),
      textMessage(fenced('{"answer":42}')),
      textMessage(fenced('{"answer":7}'), SUB),
    ]);
    expect(response.content.filter((c) => c.type === 'text')).toEqual([
      { type: 'text', text: '{"answer":42}' },
    ]);
  });

  it('a subagent tool result does not end the root turn', async () => {
    const response = await generate([
      textMessage('Checking.'),
      toolMessage('a', {}),
      toolResult('a'),
      ...launchSubagent(),
      toolMessage('read', {}, SUB),
      textMessage('{"answer":42}'),
      toolResult('read', SUB),
    ]);
    expect(response.content.filter((c) => c.type === 'text')).toEqual([
      { type: 'text', text: '{"answer":42}' },
    ]);
  });
});

describe('schema-less JSON falls back to the buffered text (#203)', () => {
  it('emits the buffered text once when text blocks streamed', async () => {
    const chunks = await collect(
      [blockStart('text', 0), text('{"answer":42}', 0), textMessage('{"answer":42}'), stop(0)],
      { type: 'json' }
    );
    expect(chunks[0].warnings).toEqual([
      expect.objectContaining({ type: 'unsupported', feature: 'responseFormat' }),
    ]);
    expect(body(chunks)).toBe('{"answer":42}');
    // No empty text part for the buffered block.
    expect(ids(chunks, 'text-start')).toHaveLength(1);
    expect(ids(chunks, 'text-end')).toHaveLength(1);
  });

  it('emits the buffered text when only complete messages arrive', async () => {
    const chunks = await collect([textMessage('{"answer":42}')], { type: 'json' });
    expect(body(chunks)).toBe('{"answer":42}');
  });

  it('does not open an empty text part for a text block in schema JSON mode', async () => {
    const chunks = await collect(
      [blockStart('text', 0), text('Here you go', 0), textMessage('Here you go'), stop(0)],
      schemaFormat,
      result({ structured_output: { answer: 42 } })
    );
    expect(body(chunks)).toBe('{"answer":42}');
    expect(ids(chunks, 'text-start')).toHaveLength(1);
  });
});
