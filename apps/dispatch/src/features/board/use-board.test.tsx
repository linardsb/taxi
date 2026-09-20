import type { AuthSession, DispatchBoardEvent } from '@taxi/shared';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOARD_SNAPSHOT_STORAGE_KEY, saveSession } from '@/features/auth';
import { OFFLINE_AFTER_FAILURES } from './board-state';
import { useBoard } from './use-board';

/**
 * Hand-rolled structural socket fake — same philosophy as the leaflet stub:
 * the tested surface is OUR lifecycle logic, and `fire()` lets a test play
 * the server. socket.io-client itself is not under test.
 */
const { fakeSocket, ioMock } = vi.hoisted(() => {
  const handlers = new Map<string, ((...args: never[]) => void)[]>();
  const fakeSocket = {
    connected: false,
    on(event: string, fn: (...args: never[]) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), fn]);
      return fakeSocket;
    },
    off: () => fakeSocket,
    close: () => undefined,
    connect: () => undefined,
    fire(event: string, ...args: unknown[]) {
      for (const fn of handlers.get(event) ?? []) {
        (fn as (...a: unknown[]) => void)(...args);
      }
    },
    handlers,
  };
  return { fakeSocket, ioMock: () => fakeSocket };
});
vi.mock('socket.io-client', () => ({ io: ioMock }));

// A STABLE router object, like the real App Router's — a fresh object per
// render would re-run every effect that lists the router in its deps.
const { replace, router } = vi.hoisted(() => {
  const replace = vi.fn();
  return { replace, router: { push: vi.fn(), replace } };
});
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const CITY = '00000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-08-15T12:00:00.000Z');

const session: AuthSession = {
  accessToken: 'token-abc',
  expiresAt: '2099-01-01T00:00:00.000Z',
  user: {
    id: '99999999-8888-4777-8666-555555555555',
    phone: '+37129999001',
    role: 'dispatcher',
    language: 'lv',
    createdAt: '2026-08-01T00:00:00.000Z',
  },
};

const frame = (over: Partial<DispatchBoardEvent> = {}): DispatchBoardEvent => ({
  cityId: CITY,
  at: NOW.toISOString(),
  rides: [],
  zones: [],
  drivers: [],
  ...over,
});

/** One online driver with no fix yet — the `lastSeenAt: null` baseline. */
const DRIVER = {
  driverId: 'd0000000-0000-4000-8000-000000000001',
  name: 'Jānis',
  phone: '+37129999001',
  location: null,
  lastSeenAt: null,
  zoneName: null,
  status: 'online' as const,
};

const okJson = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(okJson(frame()) as Response),
  );
  saveSession(session);
  fakeSocket.handlers.clear();
  fakeSocket.connected = false;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.localStorage.clear();
});

/** Server accepts the handshake; microtasks flushed so the snapshot lands. */
async function connectSocket() {
  await act(async () => {
    fakeSocket.connected = true;
    fakeSocket.fire('connect');
  });
}

describe('useBoard', () => {
  it('fetches the snapshot on connect and turns the pill live (expected)', async () => {
    const { result } = renderHook(() => useBoard());
    expect(result.current.pill).toBe('reconnecting'); // nothing proven yet

    await connectSocket();

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/dispatch/board'),
      expect.objectContaining({
        headers: { authorization: 'Bearer token-abc' },
      }),
    );
    expect(result.current.board.frame?.cityId).toBe(CITY);
    expect(result.current.pill).toBe('live');
  });

  it('withdraws live after >5 s of frame silence, socket still up (edge)', async () => {
    const { result } = renderHook(() => useBoard());
    await connectSocket();
    expect(result.current.pill).toBe('live');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });

    expect(result.current.pill).toBe('reconnecting'); // zero silent staleness
  });

  it('refetches the snapshot on every reconnect — CSR is never trusted (edge)', async () => {
    const { result } = renderHook(() => useBoard());
    await connectSocket();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);

    await act(async () => {
      fakeSocket.connected = false;
      fakeSocket.fire('disconnect', 'transport close');
    });
    await connectSocket();

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(result.current.pill).toBe('live');
  });

  it('exhausted retries → offline pill, offline alert, 5 s polling fallback (failure)', async () => {
    const { result } = renderHook(() => useBoard());
    await connectSocket();

    await act(async () => {
      fakeSocket.connected = false;
      fakeSocket.fire('disconnect', 'transport close');
      for (let i = 0; i < OFFLINE_AFTER_FAILURES; i += 1) {
        fakeSocket.fire('connect_error', new Error('xhr poll error'));
      }
    });
    expect(result.current.pill).toBe('offline');
    expect(result.current.board.alerts.some((a) => a.kind === 'offline')).toBe(
      true,
    );
    // Data survives — the frame from before the outage is still rendered.
    expect(result.current.board.frame).not.toBeNull();

    const callsBefore = vi.mocked(fetch).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });
    expect(vi.mocked(fetch).mock.calls.length).toBe(callsBefore + 1);
  });

  it('board frames arriving on the socket replace state wholesale (expected)', async () => {
    const { result } = renderHook(() => useBoard());
    await connectSocket();

    await act(async () => {
      fakeSocket.fire(
        'dispatch:board',
        frame({
          drivers: [
            {
              driverId: 'd0000000-0000-4000-8000-000000000001',
              name: 'Jānis',
              phone: '+37129999001',
              location: null,
              lastSeenAt: null,
              zoneName: null,
              status: 'online',
            },
          ],
        }),
      );
    });

    expect(result.current.board.frame?.drivers).toHaveLength(1);
  });

  it('persists every frame it applies (expected)', async () => {
    // The mechanism behind "the driver phone list survives a cold refresh with
    // the API down". Untested, a regression here would be invisible.
    renderHook(() => useBoard());
    await connectSocket();

    const stored = window.localStorage.getItem(BOARD_SNAPSHOT_STORAGE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!).cityId).toBe(CITY);
  });

  it('hydrates the stored frame on mount, STALE-marked (expected)', async () => {
    const driver = {
      driverId: 'd0000000-0000-4000-8000-000000000001',
      name: 'Jānis',
      phone: '+37129999001',
      location: null,
      lastSeenAt: null,
      zoneName: null,
      status: 'online' as const,
    };
    window.localStorage.setItem(
      BOARD_SNAPSHOT_STORAGE_KEY,
      JSON.stringify(frame({ drivers: [driver] })),
    );

    const { result } = renderHook(() => useBoard());

    // Data is there for Dina to phone off — but nothing claims it is live.
    expect(result.current.board.frame?.drivers).toHaveLength(1);
    expect(result.current.board.lastFrameAtMs).toBeNull();
    expect(result.current.pill).not.toBe('live');
  });

  it('discards a corrupt stored snapshot and starts empty (failure)', async () => {
    window.localStorage.setItem(BOARD_SNAPSHOT_STORAGE_KEY, '{not json');

    const { result } = renderHook(() => useBoard());

    expect(result.current.board.frame).toBeNull();
    // Cleaned, so a bad blob cannot bounce every load.
    expect(window.localStorage.getItem(BOARD_SNAPSHOT_STORAGE_KEY)).toBeNull();
  });

  it('discards a stored snapshot that no longer matches the wire schema (failure)', async () => {
    // Shape drift, not syntax: valid JSON the current schema rejects.
    window.localStorage.setItem(
      BOARD_SNAPSHOT_STORAGE_KEY,
      JSON.stringify({ cityId: CITY, at: NOW.toISOString() }), // no rides/drivers
    );

    const { result } = renderHook(() => useBoard());

    expect(result.current.board.frame).toBeNull();
    expect(window.localStorage.getItem(BOARD_SNAPSHOT_STORAGE_KEY)).toBeNull();
  });

  it('a late REST snapshot never overwrites a newer socket frame (edge)', async () => {
    // The reconnect race: GET /dispatch/board is issued on connect, a cold api
    // answers slowly, and the 2 s cadence lands a fresher frame first.
    const laterFrame = frame({
      at: new Date(NOW.getTime() + 2_000).toISOString(),
      drivers: [
        {
          driverId: 'd0000000-0000-4000-8000-000000000001',
          name: 'Jānis',
          phone: '+37129999001',
          location: null,
          lastSeenAt: null,
          zoneName: null,
          status: 'online',
        },
      ],
    });
    const { result } = renderHook(() => useBoard());
    await connectSocket(); // applies the t+0 REST body
    await act(async () => {
      fakeSocket.fire('dispatch:board', laterFrame);
    });
    expect(result.current.board.frame?.drivers).toHaveLength(1);

    // Now a stale REST body arrives — retry() re-fetches, mock still returns t+0.
    await act(async () => {
      result.current.retry();
      await Promise.resolve();
    });

    // Still the newer frame, and receipt time was not re-stamped as fresh.
    expect(result.current.board.frame?.drivers).toHaveLength(1);
    expect(result.current.board.frame?.at).toBe(laterFrame.at);
  });

  it('applies a well-formed driver:location onto the frame (expected, #237)', async () => {
    // The schema gate must pass what the api actually emits — a validation
    // that rejected real wire data would freeze `lastSeenAt` for good.
    const { result } = renderHook(() => useBoard());
    await connectSocket();
    await act(async () => {
      fakeSocket.fire('dispatch:board', frame({ drivers: [DRIVER] }));
    });

    await act(async () => {
      fakeSocket.fire('driver:location', {
        driverId: DRIVER.driverId,
        location: { lat: 56.95, lng: 24.1 },
        at: new Date(NOW.getTime() + 1_000).toISOString(),
      });
    });

    expect(result.current.board.frame?.drivers[0]?.lastSeenAt).toBe(
      new Date(NOW.getTime() + 1_000).toISOString(),
    );
  });

  it('drops a malformed driver:location, leaving lastSeenAt alone (failure, #237)', async () => {
    // `at` is what `driverFreshness` reads, and `Date.parse('soon')` is NaN —
    // which `NaN >= ttl` turns into green «Raida». Nothing must reach state.
    const { result } = renderHook(() => useBoard());
    await connectSocket();
    await act(async () => {
      fakeSocket.fire('dispatch:board', frame({ drivers: [DRIVER] }));
    });

    await act(async () => {
      fakeSocket.fire('driver:location', {
        driverId: DRIVER.driverId,
        location: { lat: 56.95, lng: 24.1 },
        at: 'soon',
      });
    });

    expect(result.current.board.frame?.drivers[0]?.lastSeenAt).toBeNull();
  });

  it('drops a malformed frame and withdraws the live pill (failure, #237)', async () => {
    // The drop is silent, but its consequence is not: the frame that was not
    // applied never refreshed `lastFrameAtMs`, so the board stops claiming
    // «Tiešraide» — "zero silent staleness" is what reports the bad stream.
    const { result } = renderHook(() => useBoard());
    await connectSocket();
    expect(result.current.pill).toBe('live');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
      fakeSocket.fire('dispatch:board', { cityId: CITY, at: 'whenever' });
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(result.current.board.frame?.cityId).toBe(CITY); // the good one held
    expect(result.current.board.frame?.at).toBe(NOW.toISOString());
    expect(result.current.pill).toBe('reconnecting');
  });

  it('drops a malformed dispatch:unclaimed instead of alerting on it (failure, #237)', async () => {
    const { result } = renderHook(() => useBoard());
    await connectSocket();

    await act(async () => {
      fakeSocket.fire('dispatch:unclaimed', {
        // Sole defect, so the drop can only be attributed to the uuid.
        rideId: 'not-a-uuid',
        pickup: {
          address: 'Brīvības iela 1',
          location: { lat: 56.95, lng: 24.1 },
        },
        requestedAt: NOW.toISOString(),
        unclaimedSeconds: 30,
        offerAttempts: 2,
      });
    });

    expect(result.current.board.alerts).toHaveLength(0);
  });

  it('corrects serverNowMs from a socket frame, leaving nowMs alone (expected, #238)', async () => {
    // A browser 30 s slow. `NOW` is the api's clock in this file, so setting
    // the system time back by 30 s is exactly that machine.
    vi.setSystemTime(new Date(NOW.getTime() - 30_000));
    const { result } = renderHook(() => useBoard());
    await connectSocket(); // REST snapshot — deliberately samples nothing

    expect(result.current.serverNowMs).toBe(result.current.nowMs);

    await act(async () => {
      fakeSocket.fire('dispatch:board', frame());
    });

    expect(result.current.board.serverOffsetMs).toBe(30_000);
    expect(result.current.serverNowMs).toBe(result.current.nowMs + 30_000);
    expect(result.current.serverNowMs).toBe(NOW.getTime());
  });

  it('keeps the two clocks equal on a correctly-set machine (edge, #238)', async () => {
    // The no-op property. Nothing about today's rendering may move for the
    // machine that was already right, or this fix costs more than it buys.
    const { result } = renderHook(() => useBoard());
    await connectSocket();
    await act(async () => {
      fakeSocket.fire('dispatch:board', frame());
    });

    expect(result.current.board.serverOffsetMs).toBe(0);
    expect(result.current.serverNowMs).toBe(result.current.nowMs);
  });

  it('never samples the clock from the hydrated cold start (failure, #238)', async () => {
    // A stored frame's `at` can sit arbitrarily far ahead — the same reason
    // `applyFrame` refuses it as an ORDERING baseline. Sampling it would put
    // every age 73 years out on the first paint.
    window.localStorage.setItem(
      BOARD_SNAPSHOT_STORAGE_KEY,
      JSON.stringify(frame({ at: '2099-01-01T00:00:00.000Z' })),
    );

    const { result } = renderHook(() => useBoard());

    expect(result.current.board.frame).not.toBeNull();
    expect(result.current.board.serverOffsetMs).toBe(0);
    expect(result.current.serverNowMs).toBe(result.current.nowMs);
  });

  it('an unauthorized handshake clears the session and redirects (failure)', async () => {
    renderHook(() => useBoard());

    await act(async () => {
      fakeSocket.fire('connect_error', new Error('unauthorized'));
    });

    expect(window.localStorage.getItem('taxi.console.session')).toBeNull();
    expect(replace).toHaveBeenCalledWith('/login');
  });
});
