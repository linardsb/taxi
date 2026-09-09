import * as TaskManager from 'expo-task-manager';
import { InMemoryFixQueue } from './in-memory-fix-queue';
import { LOCATION_TASK } from './location-options';
import { createLocationRuntime } from './location-task';

const T0 = 1_800_000_000_000;
const raw = (offsetMs: number) => ({
  timestamp: T0 + offsetMs,
  coords: { latitude: 56.95, longitude: 24.1, heading: 90 },
});

describe('location runtime', () => {
  it('registers the background task at module scope (expected — the defineTask rule)', () => {
    expect(TaskManager.defineTask).toHaveBeenCalledWith(
      LOCATION_TASK,
      expect.any(Function),
    );
  });

  it('throttles a burst, enqueues before any send, notifies the fix, and kicks the uploader (expected)', async () => {
    const queue = new InMemoryFixQueue();
    const runtime = createLocationRuntime(queue);
    const onFix = jest.fn();
    runtime.subscribe({ onFix });
    const kick = jest.spyOn(runtime.uploader, 'kick').mockImplementation();

    await runtime.handleLocations([raw(0), raw(1000), raw(4000)]);

    expect(await queue.count()).toBe(2);
    expect(onFix).toHaveBeenCalledWith(T0 + 4000);
    expect(kick).toHaveBeenCalledTimes(1);
  });

  it('a replayed older batch enqueues nothing and does not kick (edge)', async () => {
    const queue = new InMemoryFixQueue();
    const runtime = createLocationRuntime(queue);
    const kick = jest.spyOn(runtime.uploader, 'kick').mockImplementation();
    await runtime.handleLocations([raw(8000)]);
    kick.mockClear();

    await runtime.handleLocations([raw(0), raw(4000)]);

    expect(await queue.count()).toBe(1);
    expect(kick).not.toHaveBeenCalled();
  });

  it('an unsubscribed listener stops hearing fixes (failure)', async () => {
    const runtime = createLocationRuntime(new InMemoryFixQueue());
    jest.spyOn(runtime.uploader, 'kick').mockImplementation();
    const onFix = jest.fn();
    const off = runtime.subscribe({ onFix });
    off();

    await runtime.handleLocations([raw(0)]);

    expect(onFix).not.toHaveBeenCalled();
  });

  describe('offer-card listeners (#15)', () => {
    const socket = {} as Parameters<
      ReturnType<typeof createLocationRuntime>['setSocket']
    >[0];

    it('announces every socket change to subscribers, including the detach (expected)', () => {
      const runtime = createLocationRuntime(new InMemoryFixQueue());
      const onSocket = jest.fn();
      runtime.subscribe({ onSocket });

      runtime.setSocket(socket);
      runtime.setSocket(null);

      expect(onSocket.mock.calls).toEqual([[socket], [null]]);
    });

    it('hands a late subscriber the socket already in the slot (edge)', () => {
      const runtime = createLocationRuntime(new InMemoryFixQueue());
      runtime.setSocket(socket);
      const onSocket = jest.fn();

      runtime.subscribe({ onSocket });

      // The offers provider mounts in the root layout, but a re-mount after
      // presence connected must not stay deaf until the next reconnect.
      expect(onSocket).toHaveBeenCalledWith(socket);
    });

    it('reports the newest position even when the throttle drops it from the wire (edge)', async () => {
      const queue = new InMemoryFixQueue();
      const runtime = createLocationRuntime(queue);
      jest.spyOn(runtime.uploader, 'kick').mockImplementation();
      const onLatestFix = jest.fn();
      runtime.subscribe({ onLatestFix });

      await runtime.handleLocations([raw(0)]);
      await runtime.handleLocations([
        { ...raw(1000), coords: { ...raw(1000).coords, speed: 3.5 } },
      ]);

      // Only the first fix reached the wire queue; the card still saw both.
      expect(await queue.count()).toBe(1);
      expect(onLatestFix).toHaveBeenCalledTimes(2);
      expect(onLatestFix).toHaveBeenLastCalledWith({
        lat: 56.95,
        lng: 24.1,
        speedMps: 3.5,
        atMs: T0 + 1000,
      });
    });

    it('turns an unknown speed (absent or iOS -1) into null, never a number (edge)', async () => {
      const runtime = createLocationRuntime(new InMemoryFixQueue());
      jest.spyOn(runtime.uploader, 'kick').mockImplementation();
      const onLatestFix = jest.fn();
      runtime.subscribe({ onLatestFix });

      await runtime.handleLocations([raw(0)]);
      await runtime.handleLocations([
        { ...raw(4000), coords: { ...raw(4000).coords, speed: -1 } },
      ]);

      const speeds = onLatestFix.mock.calls.map(
        ([fix]) => (fix as { speedMps: number | null }).speedMps,
      );
      expect(speeds).toEqual([null, null]);
    });
  });

  it("the task's own error leaves a trace instead of vanishing (failure)", async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation();
    const executor = (TaskManager.defineTask as jest.Mock).mock
      .calls[0]![1] as (body: {
      data: unknown;
      error: { code: string; message: string } | null;
    }) => Promise<void>;

    await executor({
      data: null,
      error: { code: 'E_LOCATION_UNAVAILABLE', message: 'provider gone' },
    });

    expect(warn).toHaveBeenCalledWith(
      'location task error',
      'E_LOCATION_UNAVAILABLE',
      'provider gone',
    );
    warn.mockRestore();
  });
});
