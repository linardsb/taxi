import type { DriverLocationPing } from '@taxi/shared';
import { InMemoryFixQueue } from './in-memory-fix-queue';
import type { DriverSocket, EmitOutcome } from './socket';
import { FixUploader, type UploaderHooks } from './uploader';

const T0 = 1_800_000_000_000;
const fix = (n: number) => ({
  at: new Date(T0 + n * 4000).toISOString(),
  lat: 56.95,
  lng: 24.1 + n / 1000,
  heading: null,
});

/** A scripted ack sequence; `pings` records what went over the wire, in order. */
function build(outcomes: EmitOutcome[], socketUp = true) {
  const queue = new InMemoryFixQueue();
  const pings: DriverLocationPing[] = [];
  let now = T0;
  const hooks: UploaderHooks = {
    onServerOffline: jest.fn(),
    onProgress: jest.fn(),
    now: () => now,
    sleep: jest.fn((ms: number) => {
      now += ms;
      return Promise.resolve();
    }),
    random: () => 0.5, // no jitter — the backoff is exact
  };
  const script = [...outcomes];
  const emit = jest.fn((_socket: DriverSocket, ping: DriverLocationPing) => {
    pings.push(ping);
    return Promise.resolve(script.shift() ?? { accepted: true });
  });
  const socket = { connected: socketUp } as unknown as DriverSocket;
  const uploader = new FixUploader(queue, () => socket, hooks, emit);
  return { queue, uploader, hooks, emit, pings };
}

/** Lets the drain's microtasks run to completion. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('FixUploader', () => {
  it('sends oldest first and removes each fix on accepted (expected)', async () => {
    const { queue, uploader, hooks, pings } = build([]);
    await queue.enqueue([fix(1), fix(2), fix(3)]);

    uploader.kick();
    await settle();

    expect(pings.map((p) => p.at)).toEqual([fix(1).at, fix(2).at, fix(3).at]);
    expect(await queue.count()).toBe(0);
    expect(hooks.onProgress).toHaveBeenCalledTimes(3);
    expect(hooks.onProgress).toHaveBeenLastCalledWith({
      lastAckAt: T0,
      queued: 0,
    });
    expect(uploader.isRunning).toBe(false);
  });

  it('keeps the row on a timeout, backs off, and resumes in order (edge)', async () => {
    const { queue, uploader, hooks, pings } = build(['timeout']);
    await queue.enqueue([fix(1), fix(2)]);

    uploader.kick();
    await settle();

    // fix 1 twice (timeout, then accepted), then fix 2 — never fix 2 first.
    expect(pings.map((p) => p.at)).toEqual([fix(1).at, fix(1).at, fix(2).at]);
    expect(hooks.sleep).toHaveBeenCalledWith(1000);
    expect(await queue.count()).toBe(0);
  });

  it('stops on not_online with the row still queued and tells presence (failure)', async () => {
    const { queue, uploader, hooks, emit } = build([
      { accepted: false, reason: 'not_online' },
    ]);
    await queue.enqueue([fix(1), fix(2)]);

    uploader.kick();
    await settle();

    expect(emit).toHaveBeenCalledTimes(1);
    expect(hooks.onServerOffline).toHaveBeenCalledTimes(1);
    expect(await queue.count()).toBe(2);
    expect(uploader.isRunning).toBe(false);
  });

  it('drops exactly the malformed row and carries on (edge)', async () => {
    const { queue, uploader, pings } = build([
      { accepted: false, reason: 'malformed' },
    ]);
    await queue.enqueue([fix(1), fix(2)]);

    uploader.kick();
    await settle();

    expect(pings.map((p) => p.at)).toEqual([fix(1).at, fix(2).at]);
    expect(await queue.count()).toBe(0);
  });

  it('a second kick during a drain is a no-op, and a disconnected socket ends the drain (edge)', async () => {
    let release!: (o: EmitOutcome) => void;
    const gate = new Promise<EmitOutcome>((resolve) => {
      release = resolve;
    });
    const queue = new InMemoryFixQueue();
    await queue.enqueue([fix(1)]);
    const emit = jest.fn(() => gate);
    const hooks: UploaderHooks = {
      onServerOffline: jest.fn(),
      onProgress: jest.fn(),
      now: () => T0,
      sleep: () => Promise.resolve(),
    };
    const socket = { connected: true } as unknown as DriverSocket;
    const uploader = new FixUploader(queue, () => socket, hooks, emit);

    uploader.kick();
    uploader.kick();
    await settle();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(uploader.isRunning).toBe(true);

    release({ accepted: true });
    await settle();
    expect(uploader.isRunning).toBe(false);
    expect(await queue.count()).toBe(0);

    // With the socket down, a kick peeks and returns — nothing is emitted.
    await queue.enqueue([fix(2)]);
    const down = build(['disconnected']);
    await down.queue.enqueue([fix(2)]);
    down.uploader.kick();
    await settle();
    expect(await down.queue.count()).toBe(1);
    expect(down.hooks.onServerOffline).not.toHaveBeenCalled();
  });
});
