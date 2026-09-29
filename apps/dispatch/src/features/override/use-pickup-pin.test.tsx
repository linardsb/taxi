import type { AuthSession } from '@taxi/shared';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePickupPin } from './use-pickup-pin';

// The literal, as `use-assign.test.tsx` uses it: `SESSION_KEY` is not on the
// auth slice's barrel.
const SESSION_KEY = 'taxi.console.session';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
}));

const RIDE_A = 'ad000000-0000-4000-8000-000000000001';
const RIDE_B = 'ad000000-0000-4000-8000-000000000002';

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

const okJson = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});
const errJson = (status: number, message?: string) => ({
  ok: false,
  status,
  json: async () => (message === undefined ? {} : { message }),
});

const fetchMock = () => vi.mocked(fetch);

beforeEach(() => {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('usePickupPin (#275)', () => {
  it('shows the PIN from an authenticated GET to the ride (expected)', async () => {
    fetchMock().mockResolvedValue(okJson({ pin: '0042' }) as Response);
    const { result } = renderHook(() => usePickupPin());

    await act(async () => {
      await result.current.reveal(RIDE_A);
    });

    expect(result.current.state).toEqual({ kind: 'shown', pin: '0042' });
    const [url, init] = fetchMock().mock.calls[0]!;
    expect(String(url)).toMatch(new RegExp(`/rides/${RIDE_A}/pickup-pin$`));
    expect(init?.method ?? 'GET').toBe('GET');
    expect(init?.cache).toBe('no-store');
    expect(
      (init?.headers as Record<string, string>).authorization,
    ).toBe('Bearer token-abc');
  });

  it('says the car has not arrived on a 409 ride_not_arrived (edge)', async () => {
    fetchMock().mockResolvedValue(
      errJson(409, 'ride_not_arrived') as Response,
    );
    const { result } = renderHook(() => usePickupPin());

    await act(async () => {
      await result.current.reveal(RIDE_A);
    });

    expect(result.current.state).toEqual({
      kind: 'error',
      key: 'console.pin_error_not_arrived',
    });
  });

  it('falls back to the generic failure on a 500 (failure)', async () => {
    fetchMock().mockResolvedValue(errJson(500) as Response);
    const { result } = renderHook(() => usePickupPin());

    await act(async () => {
      await result.current.reveal(RIDE_A);
    });

    expect(result.current.state).toEqual({
      kind: 'error',
      key: 'console.pin_failed',
    });
  });

  it('drops the session and bounces to /login on a 401 (failure)', async () => {
    fetchMock().mockResolvedValue(errJson(401) as Response);
    const { result } = renderHook(() => usePickupPin());

    await act(async () => {
      await result.current.reveal(RIDE_A);
    });

    expect(replace).toHaveBeenCalledWith('/login');
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('never lets a stale response overwrite a newer one (edge — Q3)', async () => {
    // Ride A's read resolves LAST: Dina closed A and opened B meanwhile.
    let resolveA: (r: Response) => void = () => undefined;
    fetchMock()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveA = resolve;
          }),
      )
      .mockResolvedValueOnce(okJson({ pin: '2222' }) as Response);
    const { result } = renderHook(() => usePickupPin());

    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.reveal(RIDE_A);
    });
    await act(async () => {
      await result.current.reveal(RIDE_B);
    });
    await act(async () => {
      resolveA(okJson({ pin: '1111' }) as Response);
      await first;
    });

    expect(result.current.state).toEqual({ kind: 'shown', pin: '2222' });
  });

  it('never writes the PIN to localStorage, and clear() drops it (edge)', async () => {
    fetchMock().mockResolvedValue(okJson({ pin: '0042' }) as Response);
    const { result } = renderHook(() => usePickupPin());

    await act(async () => {
      await result.current.reveal(RIDE_A);
    });
    expect(result.current.state).toEqual({ kind: 'shown', pin: '0042' });

    const stored = Object.keys(window.localStorage).map(
      (k) => window.localStorage.getItem(k) ?? '',
    );
    expect(stored.some((v) => v.includes('0042'))).toBe(false);

    act(() => result.current.clear());
    expect(result.current.state).toEqual({ kind: 'idle' });
  });

  it('keeps a closed dialog closed when its read lands after clear() (edge, PR #300 L1)', async () => {
    let resolveA: (r: Response) => void = () => undefined;
    fetchMock().mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveA = resolve;
        }),
    );
    const { result } = renderHook(() => usePickupPin());

    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.reveal(RIDE_A);
    });
    act(() => result.current.clear());
    // Awaiting `first` means the late response has been fully handled.
    await act(async () => {
      resolveA(okJson({ pin: '1111' }) as Response);
      await first;
    });

    expect(result.current.state).toEqual({ kind: 'idle' });
  });
});
