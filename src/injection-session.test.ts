import { randomUUID } from 'node:crypto';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InjectionSession, InjectionStreamEndedError } from './injection-session.js';

const SESSION = randomUUID();
const OLD = randomUUID();
const NEW = randomUUID();
// Native SDK IO frames: only fields consumed by this adapter are scripted.
const native = (frame: Record<string, unknown>) => frame as unknown as SDKMessage;
const result = (initial: string, session = SESSION) =>
  native({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: session,
    user_message_uuid: initial,
    user_message_uuids: [initial],
    usage: { input_tokens: 11, output_tokens: 5 },
  });
const lifecycle = (uuid: string, state: string, session = SESSION) =>
  native({
    type: 'command_lifecycle',
    session_id: session,
    command_uuid: uuid,
    state,
  });
async function* frames(messages: SDKMessage[]) {
  yield* messages;
}
async function collect(session: InjectionSession, messages: SDKMessage[]) {
  const out: SDKMessage[] = [];
  try {
    for await (const frame of session.messages(frames(messages), () => {})) out.push(frame);
  } catch (error) {
    if (!(error instanceof InjectionStreamEndedError)) throw error;
  }
  return out;
}
function recovery() {
  const onResult = vi.fn();
  const session = new InjectionSession(100, onResult, { sessionId: SESSION, uuids: [OLD] });
  session.register(OLD);
  return { session, onResult };
}
afterEach(() => vi.useRealTimers());

describe('InjectionSession witnessed recovery receipts', () => {
  for (const order of ['result-first', 'completed-first'] as const) {
    it(`joins the witnessed duplicate with the exact initial success (${order})`, async () => {
      const { session, onResult } = recovery();
      const success = result(session.initialUuid);
      const completed = lifecycle(OLD, 'completed');
      const out = await collect(
        session,
        order === 'result-first' ? [success, completed] : [completed, success]
      );
      expect(out.filter((frame) => frame.type === 'result')).toHaveLength(1);
      expect([...session.absorbed]).toEqual([OLD]);
      expect(onResult.mock.calls.at(-1)?.[0]).toEqual({
        userMessageUuids: [OLD],
        pendingMessageUuids: [],
        continuationTimedOut: false,
      });
    });
  }

  it('does not infer absorption from completed alone, success alone or a fresh stream', async () => {
    const a = recovery();
    await collect(a.session, [lifecycle(OLD, 'completed')]);
    expect([...a.session.absorbed]).toEqual([]);
    const b = recovery();
    await collect(b.session, [result(b.session.initialUuid)]);
    expect([...b.session.absorbed]).toEqual([]);
    const fresh = new InjectionSession(100);
    fresh.register(OLD);
    await collect(fresh, [result(fresh.initialUuid), lifecycle(OLD, 'completed')]);
    expect([...fresh.absorbed]).toEqual([]);
  });

  it('never lends the recovery success to a newly injected UUID', async () => {
    const { session } = recovery();
    session.register(NEW);
    await collect(session, [
      result(session.initialUuid),
      lifecycle(NEW, 'completed'),
      lifecycle(OLD, 'completed'),
    ]);
    expect([...session.absorbed]).toEqual([OLD]);
    expect([...session.pending]).toEqual([NEW]);
  });

  for (const state of ['queued', 'started', 'cancelled']) {
    it(`permanently disables fallback after this generation's ${state}`, async () => {
      const { session } = recovery();
      await collect(session, [
        lifecycle(OLD, state),
        result(session.initialUuid),
        lifecycle(OLD, 'completed'),
      ]);
      expect([...session.absorbed]).toEqual([]);
      expect([...session.pending]).toEqual([OLD]);
    });
  }

  it('requires the resume session and initial prompt UUID', async () => {
    for (const success of [result(randomUUID()), result(randomUUID(), randomUUID())]) {
      const { session } = recovery();
      await collect(session, [success, lifecycle(OLD, 'completed')]);
      expect([...session.absorbed]).toEqual([]);
    }
    const { session } = recovery();
    await collect(session, [
      result(session.initialUuid, randomUUID()),
      lifecycle(OLD, 'completed'),
    ]);
    expect([...session.absorbed]).toEqual([]);
  });

  it('waits for an executing native turn own result even after completed', async () => {
    const { session } = recovery();
    const mainStart = native({
      type: 'stream_event',
      event: { type: 'message_start' },
      parent_tool_use_id: null,
      session_id: SESSION,
      user_message_uuid: OLD,
      user_message_uuids: [OLD],
    });
    await collect(session, [mainStart, result(session.initialUuid), lifecycle(OLD, 'completed')]);
    expect([...session.absorbed]).toEqual([]);
  });

  it('keeps the absolute deadline when a completed receipt never arrives', async () => {
    vi.useFakeTimers();
    const { session, onResult } = recovery();
    const close = vi.fn();
    async function* stalled() {
      yield result(session.initialUuid);
      await new Promise(() => {});
    }
    const out: SDKMessage[] = [];
    const consuming = (async () => {
      for await (const message of session.messages(stalled(), close)) out.push(message);
    })();
    await vi.advanceTimersByTimeAsync(101);
    await consuming;
    expect(close).toHaveBeenCalledOnce();
    expect(out.filter((frame) => frame.type === 'result')).toHaveLength(1);
    expect(onResult.mock.calls.at(-1)?.[0]).toEqual({
      userMessageUuids: [],
      pendingMessageUuids: [OLD],
      continuationTimedOut: true,
    });
  });
});

describe('InjectionSession recovery initial-command deadline', () => {
  it('bounds missing success after the initial command completed, without inferring usage', async () => {
    vi.useFakeTimers();
    const { session, onResult } = recovery();
    const close = vi.fn();
    async function* missingResult() {
      yield lifecycle(session.initialUuid, 'completed');
      yield lifecycle(OLD, 'completed');
      await new Promise(() => {});
    }
    const out: SDKMessage[] = [];
    const consuming = (async () => {
      for await (const message of session.messages(missingResult(), close)) out.push(message);
    })();
    await vi.advanceTimersByTimeAsync(101);
    await consuming;
    expect(out.filter((frame) => frame.type === 'result')).toEqual([]);
    expect(session.confirmedResult).toBeUndefined();
    expect(onResult.mock.calls.at(-1)?.[0]).toEqual({
      userMessageUuids: [],
      pendingMessageUuids: [OLD],
      continuationTimedOut: true,
    });
    expect(close).toHaveBeenCalledOnce();
  });
  it('never re-enables the join after the initial command was cancelled', async () => {
    const { session } = recovery();
    await collect(session, [
      lifecycle(session.initialUuid, 'cancelled'),
      result(session.initialUuid),
      lifecycle(OLD, 'completed'),
    ]);
    expect([...session.absorbed]).toEqual([]);
  });
});
