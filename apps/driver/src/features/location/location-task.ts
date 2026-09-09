import type { LocationObject } from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { selectFixes, type RawFix } from './fix-throttle';
import type { FixQueue } from './fix-queue';
import { LOCATION_TASK } from './location-options';
import type { DriverSocket } from './socket';
import { SqliteFixQueue } from './sqlite-fix-queue';
import { FixUploader, type UploaderStats } from './uploader';

/**
 * The phone's newest position, BEFORE the 4 s wire throttle (#15). The offer
 * card reads it for pickup distance and for glance mode (speed above
 * ~10 km/h); both want the OS cadence (~1 s), not the wire's. `speedMps` is
 * null when the OS gave none or a negative sentinel (iOS `-1` = unknown).
 */
export interface LatestFix {
  lat: number;
  lng: number;
  speedMps: number | null;
  atMs: number;
}

export interface RuntimeListener {
  onFix?(atMs: number): void;
  onProgress?(stats: UploaderStats): void;
  onServerOffline?(): void;
  /** The socket slot changed — attach or detach event handlers (#15). */
  onSocket?(socket: DriverSocket | null): void;
  onLatestFix?(fix: LatestFix): void;
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

function toLatestFix(raw: RawFix): LatestFix {
  const speed = raw.coords.speed;
  return {
    lat: raw.coords.latitude,
    lng: raw.coords.longitude,
    speedMps:
      speed === null ||
      speed === undefined ||
      !Number.isFinite(speed) ||
      speed < 0
        ? null
        : speed,
    atMs: raw.timestamp,
  };
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
      listeners.forEach((l) => l.onSocket?.(next));
    },
    getSocket: () => socket,
    subscribe: (listener) => {
      listeners.add(listener);
      // A listener that mounts after presence connected must not wait for the
      // next reconnect to learn the socket exists.
      if (socket) listener.onSocket?.(socket);
      return () => {
        listeners.delete(listener);
      };
    },
    async handleLocations(locations) {
      // Before the throttle: the card wants every OS delivery, the wire does not.
      const newest = locations[locations.length - 1];
      if (newest) {
        const latest = toLatestFix(newest);
        listeners.forEach((l) => l.onLatestFix?.(latest));
      }
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
    if (error) {
      // TaskManager's error is the one signal that background location died
      // (permission revoked, provider gone). Presence sees it only through
      // the dark sweep — at least leave a trace.
      console.warn('location task error', error.code, error.message);
      return;
    }
    if (!data?.locations?.length) return;
    try {
      await runtime.handleLocations(data.locations);
    } catch (err) {
      // A sqlite failure must not crash the headless task; the next batch
      // will try again and the UI's queue count will show the truth.
      console.error('location task failed', err);
    }
  },
);
