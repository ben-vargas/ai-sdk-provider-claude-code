import { randomUUID } from 'node:crypto';
import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

export interface InjectionResult {
  readonly userMessageUuids: readonly string[];
  readonly pendingMessageUuids: readonly string[];
  readonly continuationTimedOut: boolean;
}

export interface InjectionConsumption {
  readonly sessionId: string;
  readonly userMessageUuids: readonly string[];
}

export class InjectionStreamEndedError extends Error {
  constructor() {
    super('Injected CLI stream ended before all messages were confirmed');
    this.name = 'InjectionStreamEndedError';
  }
}

/** One streaming input's admission and result boundaries. */
export class InjectionSession {
  readonly initialUuid = randomUUID();
  accepting = true;
  timedOut = false;
  readonly pending = new Set<string>();
  readonly absorbed = new Set<string>();
  private readonly replayEligible: Set<string>;
  private confirmed: SDKResultMessage | undefined;

  get confirmedResult(): SDKResultMessage | undefined {
    return this.confirmed;
  }

  constructor(
    private readonly timeoutMs: number,
    private readonly onResult?: (result: InjectionResult) => void,
    private readonly recovery?: {
      sessionId?: string;
      uuids?: readonly string[];
      onConsumption?: (receipt: InjectionConsumption) => void;
    }
  ) {
    this.replayEligible = new Set(recovery?.sessionId ? recovery.uuids : []);
  }

  register(uuid: string): boolean {
    if (!this.accepting) return false;
    this.pending.add(uuid);
    return true;
  }

  private notify(): void {
    this.onResult?.({
      userMessageUuids: [...this.absorbed],
      pendingMessageUuids: [...this.pending],
      continuationTimedOut: this.timedOut,
    });
  }

  /** Hide intermediate results, never the continuation's output. */
  async *messages(
    source: AsyncIterable<SDKMessage>,
    close: () => void
  ): AsyncGenerator<SDKMessage, void> {
    const iterator = source[Symbol.asyncIterator]();
    let lastResult: SDKResultMessage | undefined;
    let deadline: number | undefined;
    let resumeSucceeded = false;
    let resumeCancelled = false;
    const completedReplays = new Set<string>();
    const confirmReplays = () => {
      if (!resumeSucceeded || resumeCancelled) return false;
      let changed = false;
      for (const uuid of completedReplays) {
        if (this.replayEligible.has(uuid) && this.pending.delete(uuid)) {
          this.absorbed.add(uuid);
          changed = true;
        }
      }
      return changed;
    };
    const totals = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };
    try {
      for (;;) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = Symbol('continuation timeout');
        let next: IteratorResult<SDKMessage> | typeof timeout;
        try {
          next =
            deadline === undefined
              ? await iterator.next()
              : await Promise.race([
                  iterator.next(),
                  new Promise<typeof timeout>((resolve) => {
                    timer = setTimeout(() => resolve(timeout), Math.max(0, deadline! - Date.now()));
                  }),
                ]);
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
        if (next === timeout) {
          this.accepting = false;
          this.timedOut = true;
          close();
          this.notify();
          if (lastResult) yield { ...lastResult, usage: { ...lastResult.usage, ...totals } };
          return;
        }
        if (next.done) {
          if (this.pending.size > 0) throw new InjectionStreamEndedError();
          return;
        }
        const message = next.value;
        if (
          (message.type === 'stream_event' || message.type === 'assistant') &&
          message.parent_tool_use_id === null
        ) {
          const uuids = [
            ...new Set(
              [message.user_message_uuid, ...(message.user_message_uuids ?? [])].filter(
                (uuid): uuid is string => typeof uuid === 'string'
              )
            ),
          ];
          for (const uuid of uuids) this.replayEligible.delete(uuid);
          if (uuids.length > 0)
            this.recovery?.onConsumption?.({
              sessionId: message.session_id,
              userMessageUuids: uuids,
            });
        }
        // Lifecycle frames are a native extension not yet in SDKMessage's union.
        const lifecycle = message as unknown as {
          type: string;
          command_uuid?: string;
          state?: string;
          session_id?: string;
        };
        if (
          lifecycle.type === 'command_lifecycle' &&
          lifecycle.session_id === this.recovery?.sessionId &&
          lifecycle.command_uuid
        ) {
          const uuid = lifecycle.command_uuid;
          if (uuid === this.initialUuid) {
            if (lifecycle.state === 'cancelled') resumeCancelled = true;
            if (
              lifecycle.state === 'completed' &&
              !resumeCancelled &&
              [...this.replayEligible].some((id) => this.pending.has(id))
            ) {
              deadline ??= Date.now() + this.timeoutMs;
            }
          }
          if (
            lifecycle.state === 'queued' ||
            lifecycle.state === 'started' ||
            lifecycle.state === 'cancelled'
          ) {
            // This ID is executing again (or cancelled), not an acknowledged
            // duplicate. Its own result must finish that native turn.
            this.replayEligible.delete(uuid);
            completedReplays.delete(uuid);
          } else if (lifecycle.state === 'completed' && this.replayEligible.has(uuid)) {
            completedReplays.add(uuid);
            if (confirmReplays()) {
              this.notify();
              if (this.pending.size === 0 && lastResult) {
                this.accepting = false;
                yield { ...lastResult, usage: { ...lastResult.usage, ...totals } };
                return;
              }
            }
          }
        }
        if (
          lastResult &&
          ((message.type === 'system' && message.subtype === 'init') ||
            (message.type === 'stream_event' && message.event.type === 'message_start'))
        ) {
          this.accepting = true;
        }
        if (message.type !== 'result') {
          yield message;
          continue;
        }
        this.accepting = false;
        lastResult = message;
        for (const key of Object.keys(totals) as Array<keyof typeof totals>) {
          totals[key] += message.usage?.[key] ?? 0;
        }
        this.confirmed = { ...message, usage: { ...message.usage, ...totals } };
        const uuids = [message.user_message_uuid, ...(message.user_message_uuids ?? [])];
        for (const uuid of uuids) {
          if (uuid && this.pending.delete(uuid)) this.absorbed.add(uuid);
        }
        if (
          message.subtype === 'success' &&
          !message.is_error &&
          message.session_id === this.recovery?.sessionId &&
          uuids.includes(this.initialUuid)
        ) {
          resumeSucceeded = true;
        }
        confirmReplays();
        this.notify();
        if (message.is_error || this.pending.size === 0) {
          yield { ...message, usage: { ...message.usage, ...totals } };
          return;
        }
        deadline ??= Date.now() + this.timeoutMs;
      }
    } finally {
      this.accepting = false;
      // A wedged iterator.return() must not defeat the continuation deadline.
      void iterator.return?.().catch(() => {});
    }
  }
}
