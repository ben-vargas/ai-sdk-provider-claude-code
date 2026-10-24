import { describe, expect, it, vi } from 'vitest';
import { ClaudeCodeLanguageModel } from './claude-code-language-model.js';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  AbortError: class extends Error {},
}));
import { query } from '@anthropic-ai/claude-agent-sdk';

// Mirrors ClaudeCodeLanguageModel.MAX_TOOL_INPUT_SIZE.
const MAX_TOOL_INPUT_SIZE = 1_048_576;
const SIZE_ERROR = /Tool input exceeds maximum size of 1048576 bytes/;

const assistant = (input: unknown, name = 'Read') => ({
  type: 'assistant',
  uuid: 'uuid-read',
  parent_tool_use_id: null,
  message: { content: [{ type: 'tool_use', id: 'read', name, input }] },
});
const result = {
  type: 'result',
  subtype: 'success',
  session_id: 'tool-input-size-test',
  usage: { input_tokens: 1, output_tokens: 1 },
};
const prompt = [{ role: 'user', content: [{ type: 'text', text: 'test' }] }] as any;
const jsonFormat = { type: 'json', schema: { type: 'object' } } as const;

function mockQuery(input: unknown, structuredOutput?: unknown) {
  vi.mocked(query).mockReturnValue({
    async *[Symbol.asyncIterator]() {
      if (structuredOutput === undefined) {
        yield assistant(input);
        yield result;
      } else {
        yield assistant(input, 'StructuredOutput');
        yield { ...result, structured_output: structuredOutput };
      }
    },
  } as any);
}
const createModel = () =>
  new ClaudeCodeLanguageModel({ id: 'sonnet', settings: { logger: false } });
async function generate(input: unknown, structuredOutput?: unknown) {
  mockQuery(input, structuredOutput);
  return createModel().doGenerate({
    prompt,
    ...(structuredOutput !== undefined && { responseFormat: jsonFormat }),
  });
}
async function stream(input: unknown, structuredOutput?: unknown) {
  mockQuery(input, structuredOutput);
  const { stream } = await createModel().doStream({
    prompt,
    ...(structuredOutput !== undefined && { responseFormat: jsonFormat }),
  });
  const chunks: any[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

const oversizedObject = () => ({ content: 'x'.repeat(MAX_TOOL_INPUT_SIZE) });
// JSON.stringify throws on cycles, forcing the String(input) fallback.
const circular = (toStringResult?: string) => {
  const input: Record<string, unknown> = {};
  input.self = input;
  if (toStringResult !== undefined) input.toString = () => toStringResult;
  return input;
};

describe('tool input size limit', () => {
  it('doGenerate rejects an oversized object input instead of emitting "[object Object]"', async () => {
    await expect(generate(oversizedObject())).rejects.toThrow(SIZE_ERROR);
  });

  it('doStream emits an error part for an oversized object input', async () => {
    const chunks = await stream(oversizedObject());
    const errors = chunks.filter((c) => c.type === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].error.message).toMatch(SIZE_ERROR);
    expect(chunks.at(-1)).toBe(errors[0]);
    // The stream error path closes the already-started tool call (with no
    // input) before the error part; the input is never "[object Object]".
    expect(chunks.filter((c) => c.type === 'tool-call').map((c) => c.input)).toEqual(['']);
    expect(chunks.some((c) => c.type === 'tool-input-delta')).toBe(false);
  });

  it('still rejects an oversized string input', async () => {
    await expect(generate('x'.repeat(MAX_TOOL_INPUT_SIZE + 1))).rejects.toThrow(SIZE_ERROR);
  });

  it('accepts an object input at the size limit', async () => {
    const input = { c: '' };
    input.c = 'x'.repeat(MAX_TOOL_INPUT_SIZE - JSON.stringify(input).length);
    const { content } = await generate(input);
    expect((content.find((c) => c.type === 'tool-call') as any).input).toBe(JSON.stringify(input));
  });

  it('keeps the String() fallback for inputs JSON.stringify cannot serialize', async () => {
    const { content } = await generate(circular());
    expect((content.find((c) => c.type === 'tool-call') as any).input).toBe('[object Object]');

    const chunks = await stream(10n);
    expect(chunks.some((c) => c.type === 'error')).toBe(false);
    expect(chunks.find((c) => c.type === 'tool-call')?.input).toBe('10');

    // JSON.stringify returns undefined (no throw) for values JSON cannot represent.
    const fn = () => 1;
    const fnResult = await generate(fn);
    expect((fnResult.content.find((c) => c.type === 'tool-call') as any).input).toBe(String(fn));
  });

  it('applies the size limit to the String() fallback', async () => {
    const input = circular('x'.repeat(MAX_TOOL_INPUT_SIZE + 1));
    await expect(generate(input)).rejects.toThrow(SIZE_ERROR);

    const errors = (await stream(input)).filter((c) => c.type === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].error.message).toMatch(SIZE_ERROR);
  });

  it('does not apply the limit to the internal StructuredOutput call in JSON mode', async () => {
    // The internal call is never emitted as a tool call; the CLI-validated
    // structured_output is the answer in both doGenerate and doStream.
    const answer = oversizedObject();
    const expected = JSON.stringify(answer);

    const { content } = await generate(answer, answer);
    expect(content.some((c) => c.type === 'tool-call')).toBe(false);
    expect(content.filter((c) => c.type === 'text').map((c: any) => c.text)).toEqual([expected]);

    const chunks = await stream(answer, answer);
    expect(chunks.some((c) => c.type === 'error')).toBe(false);
    expect(chunks.some((c) => c.type === 'tool-call')).toBe(false);
    expect(
      chunks
        .filter((c) => c.type === 'text-delta')
        .map((c) => c.delta)
        .join('')
    ).toBe(expected);
  });
});
