import {
  DRIVER_LOCATION_TTL_SECONDS,
  formatMessage,
  type DispatchBoardEvent,
} from '@taxi/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DriverList } from './driver-list';

type BoardDriver = DispatchBoardEvent['drivers'][number];

const NOW = Date.parse('2026-08-15T12:00:00.000Z');
const TTL_MS = DRIVER_LOCATION_TTL_SECONDS * 1000;

/** Seconds of silence → the ISO instant that produces it at `NOW`. */
const seenAgo = (ms: number) => new Date(NOW - ms).toISOString();

const driver = (over: Partial<BoardDriver> = {}): BoardDriver => ({
  driverId: 'd0000000-0000-4000-8000-000000000001',
  name: 'Jānis',
  phone: '+37129999001',
  location: { lat: 56.95, lng: 24.11 },
  lastSeenAt: seenAgo(4_000),
  zoneName: 'Centrs',
  status: 'online',
  ...over,
});

const FRESH = driver();
const SILENT = driver({
  driverId: 'd0000000-0000-4000-8000-000000000002',
  name: 'Anna',
  phone: '+37129999002',
  lastSeenAt: seenAgo(TTL_MS + 30_000),
});
/**
 * The unbounded case: `markOfflineByServer` returns early for anything but
 * `online`, so no sweep ever removes an `on_ride` driver. Three hours of
 * silence is reachable in production and must render.
 */
const SILENT_ON_RIDE = driver({
  driverId: 'd0000000-0000-4000-8000-000000000003',
  name: 'Pēteris',
  phone: '+37129999003',
  status: 'on_ride',
  zoneName: null,
  lastSeenAt: seenAgo(3 * 60 * 60 * 1000),
});

const live = () => screen.getByText(FRESH.name).closest('section')!;

describe('DriverList', () => {
  it('labels a reporting driver and a silent one differently (expected)', () => {
    render(
      <DriverList drivers={[FRESH, SILENT]} nowMs={NOW} boardStale={false} />,
    );

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(
      formatMessage('lv', 'console.driver_streaming'),
    );
    // 01:30 = TTL (60 s) + 30 s of further silence.
    expect(rows[1]).toHaveTextContent(
      formatMessage('lv', 'console.driver_silent', { age: '01:30' }),
    );
  });

  it('counts minutes past the hour rather than capping them (edge)', () => {
    render(
      <DriverList drivers={[SILENT_ON_RIDE]} nowMs={NOW} boardStale={false} />,
    );

    // 3 h = 180 min. `ageOf` has no hours field on purpose — the minute count
    // is the number that says how long the stream has been dead.
    expect(screen.getByRole('listitem')).toHaveTextContent(
      formatMessage('lv', 'console.driver_silent', { age: '180:00' }),
    );
  });

  it('names only the silent drivers in one polite live region (expected)', () => {
    const { container } = render(
      <DriverList
        drivers={[FRESH, SILENT, SILENT_ON_RIDE]}
        nowMs={NOW}
        boardStale={false}
      />,
    );

    const regions = container.querySelectorAll('[aria-live="polite"]');
    expect(regions).toHaveLength(1);
    expect(regions[0]).toHaveTextContent(
      formatMessage('lv', 'console.drivers_silent_summary', {
        names: `${SILENT.name}, ${SILENT_ON_RIDE.name}`,
      }),
    );
    expect(regions[0]).not.toHaveTextContent(FRESH.name);
  });

  it('keeps the live region mounted and EMPTY while every driver reports (edge)', () => {
    // Mounted-but-empty, never conditionally rendered: a region inserted at
    // the same moment its content appears is unreliably announced.
    const { container } = render(
      <DriverList drivers={[FRESH]} nowMs={NOW} boardStale={false} />,
    );

    const region = container.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(region).toHaveTextContent('');
  });

  it('treats a driver with no recorded position as silent (edge)', () => {
    const never = driver({ lastSeenAt: null, location: null });
    const { container } = render(
      <DriverList drivers={[never]} nowMs={NOW} boardStale={false} />,
    );

    expect(screen.getByRole('listitem')).toHaveTextContent(
      formatMessage('lv', 'console.driver_no_signal'),
    );
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent(
      formatMessage('lv', 'console.drivers_silent_summary', {
        names: never.name,
      }),
    );
  });

  it('says so when nobody is online rather than drawing an empty list (edge)', () => {
    render(<DriverList drivers={[]} nowMs={NOW} boardStale={false} />);

    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(
      screen.getByText(formatMessage('lv', 'console.drivers_empty')),
    ).toBeInTheDocument();
  });

  it('distinguishes silent from reporting in TEXT, not colour alone (failure)', () => {
    // #234 AC #2's check. Every assertion below reads the accessible text and
    // none reads a style value, so a later refactor cannot satisfy this suite
    // by recolouring a swatch and dropping the words.
    render(
      <DriverList drivers={[FRESH, SILENT]} nowMs={NOW} boardStale={false} />,
    );

    const text = live().textContent ?? '';
    expect(text).toContain(formatMessage('lv', 'console.driver_streaming'));
    expect(text).toContain(
      formatMessage('lv', 'console.driver_silent', { age: '01:30' }),
    );
    // The two states must not share a label — that is the whole defect. Read
    // from the RENDERED rows: comparing two catalog lookups to each other
    // asserts nothing about the panel and stays green if `DriverRow` drops
    // the label, renders both states alike, or is deleted. The freshness span
    // is the row's last child; both fixtures share a zone name, so losing the
    // span makes these equal and reddens the case.
    const rows = screen.getAllByRole('listitem');
    const labelOf = (li: HTMLElement) => li.lastElementChild?.textContent ?? '';
    expect(labelOf(rows[0]!)).not.toBe(labelOf(rows[1]!));
  });

  it('keeps the status dot and the freshness label as independent axes (edge)', () => {
    // A driver can be `on_ride` (blue dot, «Izpilda braucienu») AND silent.
    // Reading either one alone hides the other.
    render(
      <DriverList drivers={[SILENT_ON_RIDE]} nowMs={NOW} boardStale={false} />,
    );

    expect(
      screen.getByRole('img', {
        name: formatMessage('lv', 'console.driver_status_on_ride'),
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveTextContent(
      formatMessage('lv', 'console.driver_silent', { age: '180:00' }),
    );
  });

  it('refuses «Raida» for a driver who has NEVER sent a fix (failure)', () => {
    // `markOnline` seeds the `seen` score at go-online time with no GEOADD, so
    // a driver who taps the toggle with no lock arrives with a fresh
    // `lastSeenAt` and `location: null`. Reading `lastSeenAt` alone called that
    // live — green «Raida» for a phone that has reported nothing, for 60-75 s
    // (TTL 60 + sweep 15) and UNBOUNDED once force-assign makes them
    // `on_ride`, which `markOfflineByServer` never sweeps.
    const noLock = driver({ location: null, lastSeenAt: seenAgo(2_000) });
    const { container } = render(
      <DriverList drivers={[noLock]} nowMs={NOW} boardStale={false} />,
    );

    expect(screen.getByRole('listitem')).toHaveTextContent(
      formatMessage('lv', 'console.driver_no_signal'),
    );
    expect(screen.getByRole('listitem')).not.toHaveTextContent(
      formatMessage('lv', 'console.driver_streaming'),
    );
    // And the summary names them — the row and the region share one
    // derivation, so neither can drift from the other.
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent(
      formatMessage('lv', 'console.drivers_silent_summary', {
        names: noLock.name,
      }),
    );
  });

  it('blames nobody while the BOARD is the thing that went quiet (failure)', () => {
    // `nowMs` ticks, `lastSeenAt` freezes when frames stop — so a dead socket
    // looks identical to every phone dying at once. The worst case is a cold
    // refresh off localStorage, where an arbitrarily old frame would report
    // «Klusē MM:SS» for drivers streaming normally.
    const { container } = render(
      <DriverList
        drivers={[FRESH, SILENT, SILENT_ON_RIDE]}
        nowMs={NOW}
        boardStale
      />,
    );

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toHaveTextContent(
        formatMessage('lv', 'console.driver_no_signal'),
      );
    }
    // Mounted and EMPTY, never unmounted: the region must stay in the DOM, and
    // announcing a fault the drivers do not have is the defect itself.
    const region = container.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(region).toHaveTextContent('');
  });

  it('sorts the announced names so SMEMBERS order cannot re-announce (edge)', () => {
    // `frame.drivers` is `listOnline`'s order, which is `SMEMBERS`' —
    // documented as not guaranteed. Without the sort the region's text is a
    // function of the order as well as the set, and a reshuffle re-announces
    // an unchanged set.
    const { container } = render(
      <DriverList
        drivers={[SILENT_ON_RIDE, FRESH, SILENT]}
        nowMs={NOW}
        boardStale={false}
      />,
    );

    // Same set as the summary test above, opposite input order, same string.
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent(
      formatMessage('lv', 'console.drivers_silent_summary', {
        names: `${SILENT.name}, ${SILENT_ON_RIDE.name}`,
      }),
    );
  });

  it('makes the phone dialable in one tap (expected)', () => {
    // This panel carries EVERY online driver, so for a driver in no zone queue
    // it is the console's only rendering of the number — and phoning them is
    // the one action the whole feature leads to.
    render(
      <DriverList drivers={[SILENT_ON_RIDE]} nowMs={NOW} boardStale={false} />,
    );

    const link = screen.getByRole('link', { name: SILENT_ON_RIDE.phone });
    expect(link).toHaveAttribute('href', `tel:${SILENT_ON_RIDE.phone}`);
    expect(link).toHaveStyle({ minHeight: '44px' });
  });
});
