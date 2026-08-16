import { formatMessage, type TrackingView } from '@taxi/shared';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { statusLine } from './states';
import { TrackingLive } from './tracking-map';

// Leaflet touches real layout/geometry; jsdom has none. The map div is
// aria-hidden — the TEXT alternative is the tested surface — so a structural
// stub is the honest boundary here.
const mapStub = {
  setView: vi.fn(),
  remove: vi.fn(),
  attributionControl: { setPrefix: vi.fn() },
};
mapStub.setView.mockReturnValue(mapStub); // L.map(...).setView(...) is what gets stored
const markerStub = { setLatLng: vi.fn(), addTo: vi.fn() };
markerStub.addTo.mockReturnValue(markerStub); // L.marker(...).addTo(...) is what gets stored
vi.mock('leaflet', () => ({
  default: {
    map: () => mapStub,
    tileLayer: () => ({ addTo: vi.fn() }),
    marker: () => markerStub,
  },
}));

const TOKEN = 'Ab3_-6qhTGplK0vwXz9y-Q'; // 22 base64url chars, same as shared's spec
const POSITION_AT = '2026-08-11T09:00:00.000Z';
const baseView: TrackingView = {
  state: 'arriving',
  driverName: 'Jānis',
  driverPhotoUrl: null,
  vehiclePlate: 'AB-1234',
  position: { lat: 56.95, lng: 24.1, at: POSITION_AT },
  etaMinutes: 4,
  dispatchPhone: '+37160000000',
  updatedAt: POSITION_AT,
};

const okJson = (view: TrackingView) => ({
  ok: true,
  status: 200,
  json: async () => view,
});
const statusOnly = (status: number) => ({
  ok: false,
  status,
  json: async () => ({}),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-11T09:30:00.000Z')); // 30 min AFTER the fixture position
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('TrackingLive', () => {
  it('renders a terminal ride from the server view (expected)', async () => {
    render(
      <TrackingLive
        token={TOKEN}
        lang="lv"
        initial={{ ...baseView, state: 'completed' }}
      />,
    );
    // Flush the dynamic import('leaflet') the position effect kicks off.
    await act(async () => {});
    expect(screen.getByText(statusLine('lv', 'completed'))).toBeInTheDocument();
  });

  it('renders status, driver, plate and ETA from the server view (expected)', async () => {
    render(<TrackingLive token={TOKEN} lang="lv" initial={baseView} />);
    await act(async () => {});

    expect(screen.getByText(statusLine('lv', 'arriving'))).toBeInTheDocument();
    expect(screen.getByText(/Jānis/)).toBeInTheDocument();
    expect(screen.getByText(/AB-1234/)).toBeInTheDocument();
    expect(
      screen.getByText(formatMessage('lv', 'page.eta_minutes', { eta: 4 })),
    ).toBeInTheDocument();
  });

  it("keeps stamping the position's OWN recorded time after a poll (edge — stale GPS)", async () => {
    // Same position.at, NEWER updatedAt: the driver's GPS has gone silent while
    // the ride record keeps ticking. This is the ONLY shape that discriminates
    // — before the first poll, lastSeenAt is null and both implementations agree.
    const polled: TrackingView = {
      ...baseView,
      updatedAt: '2026-08-11T09:30:00.000Z',
    };
    vi.mocked(fetch).mockResolvedValue(okJson(polled) as never);

    render(<TrackingLive token={TOKEN} lang="lv" initial={baseView} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    // Derived, never hardcoded: toLocaleTimeString reads the SYSTEM timezone,
    // so a literal would pass in CI (UTC) and fail on a Europe/Riga dev box.
    const expectedTime = new Date(POSITION_AT).toLocaleTimeString('lv-LV', {
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(
      screen.getByText(
        formatMessage('lv', 'page.position_updated', { time: expectedTime }),
      ),
    ).toBeInTheDocument();
  });

  it('never polls once the ride reaches a terminal state (edge)', async () => {
    render(
      <TrackingLive
        token={TOKEN}
        lang="lv"
        initial={{ ...baseView, state: 'completed' }}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    // The `done` short-circuit is the battery/API-cost contract for a
    // finished ride: no interval, no fetch, however long the page stays open.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('stands down for retryAfterSeconds on 429 instead of polling through it (failure — #100)', async () => {
    // THE POINT OF THE FIX. Without the back-off the island keeps polling at
    // 5 s while throttled, so it spends the next window as fast as the server
    // opens it — and `retryAfterSeconds` is computed for nobody.
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ message: 'too_many_requests', retryAfterSeconds: 30 }),
    } as never);

    render(<TrackingLive token={TOKEN} lang="lv" initial={baseView} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);

    // Its own banner, naming the throttle — NOT the "connection lost" alert,
    // which would be a lie about a working system.
    expect(screen.getByRole('status')).toHaveTextContent(
      formatMessage('lv', 'page.too_many_viewers'),
    );
    expect(
      screen.queryByRole('alert'),
    ).not.toBeInTheDocument();

    // 25 s of ticks inside the 30 s window: five more intervals fire and every
    // one of them spends nothing.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25_000);
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);

    // Past the window it resumes on its own — no reload, no second effect run.
    vi.mocked(fetch).mockResolvedValue(okJson(baseView) as never);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('clamps an over-long retryAfterSeconds to the window (edge — #100 AC #2)', async () => {
    // The value crosses a network boundary, and this failure is the opposite
    // of the unreadable-body one: unbounded, a bad number freezes a LIVE page
    // for as long as it says. A day here would leave a rider watching a "wait
    // a moment" banner over a day-old position while the ride happens.
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ message: 'too_many_requests', retryAfterSeconds: 86_400 }),
    } as never);

    render(<TrackingLive token={TOKEN} lang="lv" initial={baseView} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);

    // Clamped to the 60 s window: past it the page recovers on its own.
    vi.mocked(fetch).mockResolvedValue(okJson(baseView) as never);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('falls back to a full window when the 429 body is unreadable (edge — #100)', async () => {
    // A truncated or non-JSON body must not compute a retry instant in the
    // past. Guessing LOW would defeat the throttle the back-off exists to obey.
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => {
        throw new Error('unexpected end of JSON input');
      },
    } as never);

    render(<TrackingLive token={TOKEN} lang="lv" initial={baseView} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);

    // 55 s on: still inside the 60 s fallback, so still nothing spent.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(55_000);
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('swaps the island for the expired notice when a poll returns 410 (failure)', async () => {
    vi.mocked(fetch).mockResolvedValue(statusOnly(410) as never);

    render(<TrackingLive token={TOKEN} lang="lv" initial={baseView} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(screen.getByRole('status')).toHaveTextContent(
      formatMessage('lv', 'page.expired'),
    );
  });
});
