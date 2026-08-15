import type { AuthSession, DispatchBoardEvent } from '@taxi/shared';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveSession } from '@/features/auth';
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
  expiresAt: '2026-09-14T12:00:00.000Z',
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
  drivers: [],
  ...over,
});

const okJson = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(frame()) as Response));
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

  it('an unauthorized handshake clears the session and redirects (failure)', async () => {
    renderHook(() => useBoard());

    await act(async () => {
      fakeSocket.fire('connect_error', new Error('unauthorized'));
    });

    expect(window.localStorage.getItem('taxi.console.session')).toBeNull();
    expect(replace).toHaveBeenCalledWith('/login');
  });
});
