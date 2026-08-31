import type { LocationObject } from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { selectFixes, type RawFix } from './fix-throttle';
import type { FixQueue } from './fix-queue';
import { LOCATION_TASK } from './location-options';
import type { DriverSocket } from './socket';
import { SqliteFixQueue } from './sqlite-fix-queue';
import { FixUploader, type UploaderStats } from './uploader';

export interface RuntimeListener {
  onFix?(atMs: number): void;
  onProgress?(stats: UploaderStats): void;
  onServerOffline?(): void;
}

export interface LocationRuntime {
  queue: FixQueue;
  uploader: FixUploader;
  setSocket(next: DriverSocket | null): void;
  getSocket(): DriverSocket | null;
  subscribe(listener: RuntimeListener): () => void;
  /** The task body: throttle → enqueue → kick. Exported so a test drives it with a fake queue. */
  handleLocations(locations: readonly RawFix[]): Promise<void>;
}

/**
 * Everything the headless task and the UI share: ONE queue, ONE uploader,
 * ONE socket slot. The task runs with no React tree (a process the OS
 * restarted for a fix has no `_layout` mounted), so it queues to sqlite and
 * kicks; with no socket set, the kick returns and the queue waits for the
 * next app open.
 */
export function createLocationRuntime(queue: FixQueue): LocationRuntime {
  let socket: DriverSocket | null = null;
  let lastEnqueuedTs: number | null = null;
  const listeners = new Set<RuntimeListener>();

  const uploader = new FixUploader(queue, () => socket, {
    onServerOffline: () => listeners.forEach((l) => l.onServerOffline?.()),
    onProgress: (stats) => listeners.forEach((l) => l.onProgress?.(stats)),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });

  return {
    queue,
    uploader,
    setSocket: (next) => {
      socket = next;
    },
    getSocket: () => socket,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async handleLocations(locations) {
      const { fixes, lastTs } = selectFixes(locations, lastEnqueuedTs);
      lastEnqueuedTs = lastTs;
      if (fixes.length === 0) return;
      await queue.enqueue(fixes);
      listeners.forEach((l) =>
        l.onFix?.(Date.parse(fixes[fixes.length - 1]!.at)),
      );
      uploader.kick();
    },
  };
}

const runtime = createLocationRuntime(new SqliteFixQueue());

/** The one runtime the presence hook wires its socket into. */
export function getLocationRuntime(): LocationRuntime {
  return runtime;
}

/**
 * Registered at MODULE SCOPE — `expo-task-manager` requires `defineTask` in
 * the global scope of the bundle, which is satisfied by `src/app/_layout.tsx`
 * importing this file first. Nothing here may import a React component.
 */
TaskManager.defineTask<{ locations: LocationObject[] }>(
  LOCATION_TASK,
  async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    try {
      await runtime.handleLocations(data.locations);
    } catch (err) {
      // A sqlite failure must not crash the headless task; the next batch
      // will try again and the UI's queue count will show the truth.
      console.error('location task failed', err);
    }
  },
);
