import { formatMessage } from '@taxi/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BoardState, PillState } from './board-state';

/**
 * The page's own states, with `useBoard` replaced and everything else real —
 * `isStale`, the panels and the catalog all run, so the banner's CONDITION is
 * what is under test, not a restatement of it.
 */
const useBoardMock = vi.fn();
vi.mock('@/features/board', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./index')>()),
  useBoard: () => useBoardMock(),
}));

// #19's override slice calls `useRouter` (to bounce a dead session to /login),
// and outside the app-router runtime that throws "invariant expected app
// router to be mounted" before the page renders at all.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

// The zones view is the default, so leaflet never mounts — but the module is
// still imported, and jsdom has no real leaflet runtime.
vi.mock('leaflet', () => ({
  default: {
    map: () => ({
      setView: vi.fn().mockReturnThis(),
      remove: vi.fn(),
      attributionControl: { setPrefix: vi.fn() },
    }),
    tileLayer: () => ({ addTo: vi.fn() }),
    marker: () => ({ addTo: vi.fn().mockReturnThis(), bindTooltip: vi.fn() }),
  },
}));

const { default: DispatchPage } = await import('@/app/dispatch/page');

const CITY = '00000000-0000-4000-8000-000000000001';
const NOW = Date.parse('2026-08-15T12:00:00.000Z');

const frame = () => ({
  cityId: CITY,
  at: new Date(NOW).toISOString(),
  rides: [],
  zones: [],
  drivers: [],
});

function boardWith(over: Partial<BoardState> = {}): BoardState {
  return { frame: frame(), lastFrameAtMs: NOW, alerts: [], ...over };
}

function mount(pill: PillState, board: BoardState, nowMs = NOW) {
  useBoardMock.mockReturnValue({
    board,
    pill,
    nowMs,
    retry: vi.fn(),
    ack: vi.fn(),
  });
  return render(<DispatchPage />);
}

/**
 * The catalog string's literal lead, up to the `({time})` slot — the timestamp
 * itself is locale-formatted and reproducing it here would only re-implement
 * `timeOf`.
 */
const lead = (key: 'console.stale_banner' | 'console.stale_banner_silent') =>
  formatMessage('lv', key).split('(')[0]!.trim();

/**
 * The banner by its TEXT, not by `role="alert"` — the alerts panel keeps its
 * own always-mounted live region, so the page legitimately has two.
 */
const bannerFor = (
  key: 'console.stale_banner' | 'console.stale_banner_silent',
) => screen.queryByText(lead(key), { exact: false });

const retryButton = () =>
  screen.queryByRole('button', { name: formatMessage('lv', 'console.retry') });

describe('DispatchPage — the plan’s Error state', () => {
  it('shows no banner while frames are arriving (expected)', () => {
    mount('live', boardWith());

    expect(bannerFor('console.stale_banner')).toBeNull();
    expect(bannerFor('console.stale_banner_silent')).toBeNull();
    expect(retryButton()).toBeNull(); // no affordance implies nothing is wrong
  });

  it('offers retry when CONNECTED but silent past the heartbeat (edge)', () => {
    // Handshake fine, emitter broken — the board build throws every beat. The
    // pill reads «Atjaunojas…» forever; without this the operator has no age
    // and nothing to click, while ride ages keep ticking and look alive.
    mount('reconnecting', boardWith({ lastFrameAtMs: NOW - 6_000 }));

    // «Bezsaistē» would be a lie — the socket is up, it is merely silent.
    expect(bannerFor('console.stale_banner_silent')).toBeInTheDocument();
    expect(bannerFor('console.stale_banner')).toBeNull();
    expect(retryButton()).toBeInTheDocument();
  });

  it('still says «Bezsaistē» when the pill has given up (edge)', () => {
    mount('offline', boardWith({ lastFrameAtMs: NOW - 6_000 }));

    expect(bannerFor('console.stale_banner')).toBeInTheDocument();
    expect(retryButton()).toBeInTheDocument();
  });

  it('stays quiet on the cold first paint — the loading state speaks (failure)', () => {
    // No frame yet and none stored: isStale(now, null) is true, but there is
    // no "last known data" to caveat and a banner here would flash on every
    // load.
    mount('reconnecting', boardWith({ frame: null, lastFrameAtMs: null }));

    expect(bannerFor('console.stale_banner_silent')).toBeNull();
    expect(retryButton()).toBeNull();
    expect(
      screen.getByText(formatMessage('lv', 'console.loading')),
    ).toBeInTheDocument();
  });

  it('caveats a HYDRATED frame — data shown, never claimed live (edge)', () => {
    // Cold refresh with the API down: the phone list is on screen off
    // localStorage, and the banner is what stops it reading as current.
    mount('reconnecting', boardWith({ lastFrameAtMs: null }));

    expect(bannerFor('console.stale_banner_silent')).toBeInTheDocument();
    expect(retryButton()).toBeInTheDocument();
  });
});
