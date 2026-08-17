import type { AuthSession } from '@taxi/shared';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAssign } from './use-assign';

// The literal, not the auth slice's constant: `SESSION_KEY` is not on
// that slice's barrel, and reaching past an index.ts is what the barrel exists
// to prevent. Same call `use-board.test.tsx` makes.
const SESSION_KEY = 'taxi.console.session';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
}));

const RIDE_ID = 'ad000000-0000-4000-8000-000000000001';
const DRIVER_ID = 'd0000000-0000-4000-8000-000000000001';

const session: AuthSession = {
  accessToken: 'token-abc',
  expiresAt: '2099-01-01T00:00:00.000Z',
  user: {
    id: '99999999-8888-4777-8666-555555555555',
    phone: '+37129999000',
    role: 'dispatcher',
    language: 'lv',
    createdAt: '2026-08-01T00:00:00.000Z',
  },
};

const rosterBody = {
  at: '2026-08-17T12:00:00.000Z',
  drivers: [
    {
      driverId: DRIVER_ID,
      name: 'Jānis Ozols',
      phone: '+37129999001',
      status: 'offline',
      vehiclePlate: 'AB-1234',
      zoneName: null,
      activeRideId: null,
    },
  ],
};

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const errJson = (status: number, message?: string) => ({
  ok: false,
  status,
  json: async () => (message === undefined ? {} : { message }),
});

beforeEach(() => {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('useAssign — roster', () => {
  it('fetches the roster only when asked, and parses it (expected)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okJson(rosterBody) as never);
    const { result } = renderHook(() => useAssign());

    // Nothing on mount: the roster is a dialog-open read, not a board cadence.
    expect(fetch).not.toHaveBeenCalled();

    await act(() => result.current.loadRoster());

    expect(result.current.roster).toHaveLength(1);
    // The OFFLINE driver survives the round trip — the whole point of the read.
    expect(result.current.roster[0]?.status).toBe('offline');
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain('/dispatch/drivers');
  });

  it('bounces to /login when the token died under it (failure)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(errJson(401) as never);
    const { result } = renderHook(() => useAssign());

    await act(() => result.current.loadRoster());

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('reports a generic failure when the roster body is unreadable (failure)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okJson({ at: 'not-a-date', drivers: [] }) as never,
    );
    const { result } = renderHook(() => useAssign());

    await act(() => result.current.loadRoster());

    expect(result.current.errorKey).toBe('console.assign_failed');
  });
});

describe('useAssign — writes', () => {
  it('posts an assign to the force-assign route with the reason (expected)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okJson({ rideId: RIDE_ID }) as never);
    const { result } = renderHook(() => useAssign());

    let outcome;
    await act(async () => {
      outcome = await result.current.assign(RIDE_ID, DRIVER_ID, 'VIP regular');
    });

    expect(outcome).toEqual({ ok: true });
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(url).toContain(`/dispatch/rides/${RIDE_ID}/assign`);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      driverId: DRIVER_ID,
      reason: 'VIP regular',
    });
  });

  it('posts a reassign to its own route, never the assign one (expected)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okJson({ rideId: RIDE_ID }) as never);
    const { result } = renderHook(() => useAssign());

    await act(async () => {
      await result.current.reassign(RIDE_ID, DRIVER_ID, null);
    });

    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain('/reassign');
  });

  it('cancels through the lifecycle route, which already accepts a dispatcher (expected)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okJson({ ok: true }) as never);
    const { result } = renderHook(() => useAssign());

    await act(async () => {
      await result.current.cancel(RIDE_ID, 'caller changed their mind');
    });

    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain(
      `/rides/${RIDE_ID}/cancel`,
    );
  });

  it('maps the mid-cascade 409 to operator language (edge)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      errJson(409, 'ride_not_assignable') as never,
    );
    const { result } = renderHook(() => useAssign());

    let outcome;
    await act(async () => {
      outcome = await result.current.assign(RIDE_ID, DRIVER_ID, null);
    });

    // THE failure path for this feature: an offline driver assigns fine; a
    // ride that moved on is what actually fails, and the cascade resuming is
    // the re-offer.
    expect(outcome).toEqual({
      ok: false,
      key: 'console.assign_error_ride_not_assignable',
    });
    expect(result.current.errorKey).toBe(
      'console.assign_error_ride_not_assignable',
    );
  });

  it('never renders an unmapped api code at the dispatcher (failure)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      errJson(409, 'some_future_code') as never,
    );
    const { result } = renderHook(() => useAssign());

    await act(async () => {
      await result.current.assign(RIDE_ID, DRIVER_ID, null);
    });

    expect(result.current.errorKey).toBe('console.assign_failed');
  });

  it('survives a network throw rather than rejecting into the dialog (failure)', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useAssign());

    let outcome;
    await act(async () => {
      outcome = await result.current.assign(RIDE_ID, DRIVER_ID, null);
    });

    expect(outcome).toEqual({ ok: false, key: 'console.assign_failed' });
  });

  it('clears the error on reset so a retry starts clean (edge)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(errJson(409, 'ride_not_found') as never);
    const { result } = renderHook(() => useAssign());

    await act(async () => {
      await result.current.assign(RIDE_ID, DRIVER_ID, null);
    });
    expect(result.current.errorKey).not.toBeNull();

    act(() => result.current.reset());
    expect(result.current.errorKey).toBeNull();
  });
});
