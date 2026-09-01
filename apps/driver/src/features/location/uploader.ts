import { nextBackoffMs } from './backoff';
import { toPing, type FixQueue } from './fix-queue';
import { emitFixWithAck, type DriverSocket } from './socket';

/** How many fixes one drain pass reads at a time. */
export const PEEK_BATCH = 50;
/** How long one ack may take before the fix is retried. */
export const ACK_TIMEOUT_MS = 5_000;

export interface UploaderStats {
  lastAckAt: number;
  queued: number;
}

export interface UploaderHooks {
  /** The server said `not_online` — the presence layer re-asserts and re-kicks. */
  onServerOffline(): void;
  onProgress(stats: UploaderStats): void;
  now(): number;
  sleep(ms: number): Promise<void>;
  random?: () => number;
}

/**
 * Drains the durable queue over the socket, ONE FIX AT A TIME, oldest
 * first, awaiting each ack — parallel emits would reorder the track and
 * make the server's per-fix log unreadable. A fix leaves the queue only on
 * `accepted: true` (or `malformed`, which no retry can fix); everything
 * else backs off and retries from the same row.
 */
export class FixUploader {
  private running = false;
  private stopped = false;
  private attempt = 0;

  constructor(
    private readonly queue: FixQueue,
    private readonly socket: () => DriverSocket | null,
    private readonly hooks: UploaderHooks,
    private readonly emit: typeof emitFixWithAck = emitFixWithAck,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** Starts a drain unless one is in flight — a second kick mid-drain is a no-op. */
  kick(): void {
    if (this.running) return;
    this.stopped = false;
    this.running = true;
    void this.drain().finally(() => {
      this.running = false;
    });
  }

  /** Ends the current drain after the fix in flight. */
  stop(): void {
    this.stopped = true;
  }

  /** Resolves when the drain ends or `timeoutMs` passes — the go-offline grace. */
  async whenIdle(timeoutMs: number): Promise<void> {
    const deadline = this.hooks.now() + timeoutMs;
    while (this.running && this.hooks.now() < deadline) {
      await this.hooks.sleep(100);
    }
  }

  private async drain(): Promise<void> {
    while (!this.stopped) {
      const batch = await this.queue.peek(PEEK_BATCH);
      if (batch.length === 0) return;

      let retry = false;
      for (const fix of batch) {
        if (this.stopped) return;
        const socket = this.socket();
        if (!socket) return; // no session yet — the connect handler re-kicks
        const outcome = await this.emit(socket, toPing(fix), ACK_TIMEOUT_MS);
        if (outcome === 'disconnected') return; // ditto
        if (
          outcome === 'timeout' ||
          (!outcome.accepted && outcome.reason === 'store_unavailable')
        ) {
          retry = true;
          break; // re-peek from the same row after the backoff
        }
        if (outcome.accepted) {
          await this.queue.remove([fix.id]);
          this.attempt = 0;
          this.hooks.onProgress({
            lastAckAt: this.hooks.now(),
            queued: await this.queue.count(),
          });
          continue;
        }
        if (outcome.reason === 'malformed') {
          await this.queue.remove([fix.id]); // retrying cannot help
          continue;
        }
        // `not_online`: the server no longer holds us. Stop with the row
        // queued; presence re-asserts (or flips) and kicks again.
        this.hooks.onServerOffline();
        return;
      }
      if (retry) {
        await this.hooks.sleep(nextBackoffMs(this.attempt, this.hooks.random));
        this.attempt += 1;
      }
    }
  }
}
