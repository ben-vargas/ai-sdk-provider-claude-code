import { describe, expect, it, vi } from 'vitest';
import { ClaudeCodeLanguageModel } from './claude-code-language-model.js';

// Like the real SDK's AbortError, this class does not set name = 'AbortError'.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  AbortError: class extends Error {},
}));
import { AbortError, query } from '@anthropic-ai/claude-agent-sdk';

// The caller's AbortSignal reason survives the SDK's abort error (#204).
const SDK_ABORT_MESSAGE = 'Claude Code process aborted by user';
const prompt = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'test' }] }];
const model = () => new ClaudeCodeLanguageModel({ id: 'sonnet', settings: { logger: false } });

// The SDK aborts mid-stream: the caller aborts (when `abort` is given), then the
// SDK throws its abort error.
function mockSdkAbort(abort?: () => void) {
  vi.mocked(query).mockReturnValue({
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        abort?.();
        throw new AbortError(SDK_ABORT_MESSAGE);
      },
    }),
  } as any);
}
async function streamError(abortSignal?: AbortSignal) {
  const { stream } = await model().doStream({ prompt, abortSignal });
  const chunks: any[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks.find((c) => c.type === 'error')?.error;
}

describe('caller abort reason (#204)', () => {
  it('doGenerate rethrows a custom abort reason', async () => {
    const controller = new AbortController();
    const reason = new Error('Complex analysis timeout after 60000ms');
    mockSdkAbort(() => controller.abort(reason));
    await expect(model().doGenerate({ prompt, abortSignal: controller.signal })).rejects.toBe(
      reason
    );
  });

  it('doStream emits a custom abort reason as the error', async () => {
    const controller = new AbortController();
    const reason = new Error('Complex analysis timeout after 60000ms');
    mockSdkAbort(() => controller.abort(reason));
    expect(await streamError(controller.signal)).toBe(reason);
  });

  it('keeps the SDK abort error for an abort without a reason', async () => {
    const controller = new AbortController();
    mockSdkAbort(() => controller.abort());
    await expect(model().doGenerate({ prompt, abortSignal: controller.signal })).rejects.toThrow(
      SDK_ABORT_MESSAGE
    );

    const otherController = new AbortController();
    mockSdkAbort(() => otherController.abort());
    expect((await streamError(otherController.signal))?.message).toBe(SDK_ABORT_MESSAGE);
  });

  it('keeps the SDK abort error when the caller did not abort', async () => {
    mockSdkAbort();
    await expect(
      model().doGenerate({ prompt, abortSignal: new AbortController().signal })
    ).rejects.toThrow(SDK_ABORT_MESSAGE);

    mockSdkAbort();
    expect((await streamError())?.message).toBe(SDK_ABORT_MESSAGE);
  });
});
