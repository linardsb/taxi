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
});
