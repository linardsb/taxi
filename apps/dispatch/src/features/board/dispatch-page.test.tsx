import { DRIVER_LOCATION_TTL_SECONDS, formatMessage } from '@taxi/shared';
import { fireEvent, render, screen } from '@testing-library/react';
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

/**
 * The drivers panel is mounted OUTSIDE the zones/map ternary, and this is the
 * test that pins it there (#234).
 *
 * Without it, a later refactor can move the panel into either branch and every
 * other check stays green while the board loses its freshness signal in the
 * other view — which is exactly the shape of the defect this ticket closed.
 */
const SILENT_DRIVER = {
  driverId: 'd0000000-0000-4000-8000-000000000002',
  name: 'Anna',
  phone: '+37129999002',
  location: { lat: 56.95, lng: 24.11 },
  // TTL + 30 s → «Klusē 01:30».
  lastSeenAt: new Date(
    NOW - (DRIVER_LOCATION_TTL_SECONDS * 1000 + 30_000),
  ).toISOString(),
  zoneName: 'Centrs',
  status: 'online' as const,
};

const silenceLabel = () =>
  formatMessage('lv', 'console.driver_silent', { age: '01:30' });

describe('DispatchPage — driver freshness survives the view toggle', () => {
  it('shows the silence label in the default zones view (expected)', () => {
    mount('live', boardWith({ frame: { ...frame(), drivers: [SILENT_DRIVER] } }));

    expect(screen.getByText(silenceLabel())).toBeInTheDocument();
  });

  it('still shows it after switching to the map view (edge)', async () => {
    mount('live', boardWith({ frame: { ...frame(), drivers: [SILENT_DRIVER] } }));

    fireEvent.click(
      screen.getByRole('button', { name: formatMessage('lv', 'console.map') }),
    );

    // `vi.waitFor`, not a bare assertion: the toggle re-renders and the map's
    // leaflet effect lands a macrotask later, so asserting on the commit alone
    // flakes on CI while staying green locally (#189).
    await vi.waitFor(() => {
      expect(screen.getByText(silenceLabel())).toBeInTheDocument();
    });
  });
});

/**
 * The panel reads the SAME staleness the banner does, and this is the test
 * that pins the wiring (PR #236 review, F2).
 *
 * `boardStale` is a required prop, so dropping it entirely is a typecheck
 * failure — but passing a WRONG value, or a literal `false`, compiles. The
 * cases above cannot catch that: both supply `lastFrameAtMs: NOW` and
 * `pill: 'live'`, so `showStaleBanner` is `false` in each and the prop's value
 * is never exercised. This is the case that goes red if the thread from
 * `showStaleBanner` is cut.
 */
describe('DispatchPage — a deaf console does not accuse the drivers', () => {
  const FRESH_DRIVER = {
    ...SILENT_DRIVER,
    driverId: 'd0000000-0000-4000-8000-000000000001',
    name: 'Jānis',
    phone: '+37129999001',
    lastSeenAt: new Date(NOW - 4_000).toISOString(),
  };

  it('reads the drivers as silent while the board itself is fresh (expected)', () => {
    // The control, and it does real work: it proves the two failure cases
    // below are empty BECAUSE of `boardStale` and not because this fixture
    // produces an empty region either way.
    const { container } = mount(
      'live',
      boardWith({
        frame: { ...frame(), drivers: [SILENT_DRIVER, FRESH_DRIVER] },
      }),
    );

    expect(bannerFor('console.stale_banner_silent')).toBeNull();
    expect(screen.getByText(silenceLabel())).toBeInTheDocument();
    // Two polite regions on this page: the connection pill and the driver
    // summary. With the board fresh, the summary names the silent driver.
    const regions = container.querySelectorAll('[aria-live="polite"]');
    expect(regions).toHaveLength(2);
    expect(
      [...regions].some((r) => r.textContent?.includes(SILENT_DRIVER.name)),
    ).toBe(true);
  });

  it('shows «Nav signāla» instead of «Klusē» once the board is stale (failure)', () => {
    // Handshake fine, frames stopped: the banner is up, and every row's age is
    // now the console's silence rather than the driver's. A fresh-streaming
    // driver would read «Klusē MM:SS» without the thread.
    //
    // 16 s, not the banner's 6 s: the panel's window is `PANEL_STALE_MS`
    // (15 s) and not `STALE_MS`, because the poll fallback would otherwise
    // blank it while the board is current (round 2, M2). This fixture is past
    // both, so the banner and the panel agree here — the case below the
    // describe pins the range where they deliberately do not.
    mount(
      'reconnecting',
      boardWith({
        frame: { ...frame(), drivers: [SILENT_DRIVER, FRESH_DRIVER] },
        lastFrameAtMs: NOW - 16_000,
      }),
    );

    expect(bannerFor('console.stale_banner_silent')).toBeInTheDocument();
    expect(screen.queryByText(silenceLabel())).toBeNull();
    expect(
      screen.queryByText(formatMessage('lv', 'console.driver_streaming')),
    ).toBeNull();
    expect(
      screen.getAllByText(formatMessage('lv', 'console.driver_no_signal')),
    ).toHaveLength(2);
  });

  it('announces nobody on a hydrated cold refresh (failure)', () => {
    // `hydratedBoard()` restores an arbitrarily old frame with
    // `lastFrameAtMs: null` deliberately. Without the thread, EVERY driver is
    // named in the live region on the first paint with every phone streaming.
    const { container } = mount(
      'reconnecting',
      boardWith({
        frame: { ...frame(), drivers: [SILENT_DRIVER, FRESH_DRIVER] },
        lastFrameAtMs: null,
      }),
    );

    const regions = container.querySelectorAll('[aria-live="polite"]');
    // Two, and the count is asserted so this cannot pass by the region having
    // been unmounted: the connection pill's and the driver summary's.
    expect(regions).toHaveLength(2);
    for (const region of regions) {
      expect(region).not.toHaveTextContent(SILENT_DRIVER.name);
      expect(region).not.toHaveTextContent(FRESH_DRIVER.name);
    }
  });

  it('keeps reading the rows while the REST fallback is current (failure)', () => {
    // Websocket blocked, HTTP fine — a proxy or a corporate network, which is
    // the exact state `use-board.ts:211-222`'s poll fallback exists for. The
    // pill is «Bezsaistē» because the socket gave up, and every successful
    // poll runs `applyFrame(s, frame, Date.now())` (`:117`), so the frame is
    // at most one poll old and the board is demonstrably current. Reading the
    // PILL here would blank the panel in the one state it was built to
    // survive; reading the FRAME AGE keeps the signal on.
    mount(
      'offline',
      boardWith({
        frame: { ...frame(), drivers: [SILENT_DRIVER, FRESH_DRIVER] },
        lastFrameAtMs: NOW - 1_000,
      }),
    );

    expect(bannerFor('console.stale_banner')).toBeInTheDocument();
    expect(screen.getByText(silenceLabel())).toBeInTheDocument();
    expect(
      screen.getByText(formatMessage('lv', 'console.driver_streaming')),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(formatMessage('lv', 'console.driver_no_signal')),
    ).toBeNull();
  });
});
