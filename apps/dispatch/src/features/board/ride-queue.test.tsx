import {
  BOARD_LIVE_RIDE_STATUSES,
  dispatchBoardEventSchema,
  formatMessage,
  type DispatchBoardEvent,
} from '@taxi/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RideQueue } from './ride-queue';

type BoardRide = DispatchBoardEvent['rides'][number];

const NOW = Date.parse('2026-08-15T12:00:00.000Z');

const ride = (over: Partial<BoardRide>): BoardRide => ({
  rideId: '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c',
  status: 'requested',
  pickup: { location: { lat: 56.95, lng: 24.11 }, address: 'Brīvības 1' },
  driverId: null,
  driverName: null,
  bookingChannel: 'phone',
  requestedAt: '2026-08-15T11:58:00.000Z',
  unclaimedSeconds: 120,
  ...over,
});

const none: ReadonlySet<string> = new Set();

describe('RideQueue', () => {
  it('buckets rides and shows status, driver and age in place (expected)', () => {
    render(
      <RideQueue
        rides={[
          ride({}),
          ride({
            rideId: '4f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c',
            status: 'offered',
            pickup: {
              location: { lat: 56.96, lng: 24.12 },
              address: 'Hanzas 3',
            },
          }),
          ride({
            rideId: '5f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c',
            status: 'in_progress',
            driverId: 'd0000000-0000-4000-8000-000000000001',
            driverName: 'Jānis Ozols',
            pickup: {
              location: { lat: 56.97, lng: 24.13 },
              address: 'Teika 5',
            },
            unclaimedSeconds: 0,
          }),
        ]}
        nowMs={NOW}
        flashRideIds={none}
      />,
    );

    expect(
      screen.getByText(`${formatMessage('lv', 'console.queue_requested')} (1)`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`${formatMessage('lv', 'console.queue_offered')} (1)`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`${formatMessage('lv', 'console.queue_active')} (1)`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(formatMessage('lv', 'console.status_in_progress')),
    ).toBeInTheDocument();
    expect(screen.getByText('Jānis Ozols')).toBeInTheDocument();
    // All three fixture rides were requested 2 min before NOW.
    expect(screen.getAllByText('02:00')).toHaveLength(3);
  });

  it('shows catalog empty-copy per empty bucket (edge)', () => {
    render(<RideQueue rides={[]} nowMs={NOW} flashRideIds={none} />);
    expect(
      screen.getAllByText(formatMessage('lv', 'console.empty_queue')),
    ).toHaveLength(3);
  });

  it('flashes ONLY rides with an active unclaimed alert (edge — S9-4)', () => {
    render(
      <RideQueue
        rides={[
          ride({}),
          ride({
            rideId: '4f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c',
            pickup: {
              location: { lat: 56.96, lng: 24.12 },
              address: 'Hanzas 3',
            },
          }),
        ]}
        nowMs={NOW}
        flashRideIds={new Set(['3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c'])}
      />,
    );

    const flashed = screen.getByText('Brīvības 1').closest('li');
    const calm = screen.getByText('Hanzas 3').closest('li');
    expect(flashed).toHaveClass('console-flash');
    expect(calm).not.toHaveClass('console-flash');
  });

  it('cannot be handed a terminal ride — the wire schema refuses it (failure)', () => {
    // This used to be a runtime drop: the wire enum was the FULL RIDE_STATUSES
    // and the component silently bucketed a `completed` ride nowhere. Narrowed
    // to BOARD_LIVE_RIDE_STATUSES, the payload never parses in the first place,
    // so the console cannot receive one — `ride({ status: 'completed' })` is
    // now a type error too.
    const withTerminal = {
      cityId: '00000000-0000-4000-8000-000000000001',
      at: '2026-08-15T12:00:00.000Z',
      rides: [{ ...ride({}), status: 'completed' }],
      drivers: [],
    };
    expect(dispatchBoardEventSchema.safeParse(withTerminal).success).toBe(
      false,
    );
  });

  it('labels every status the board can carry — no raw enum can leak (edge)', () => {
    // STATUS_KEY is total over BoardRideStatus, so this is the runtime half of
    // that guarantee: an unlabelled status would print a raw English enum on
    // an LV-only console.
    render(
      <RideQueue
        rides={BOARD_LIVE_RIDE_STATUSES.map((status, i) =>
          ride({
            rideId: `${i}f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c`,
            status,
            pickup: {
              location: { lat: 56.95, lng: 24.11 },
              address: `Adrese ${i}`,
            },
          }),
        )}
        nowMs={NOW}
        flashRideIds={none}
      />,
    );

    for (const status of BOARD_LIVE_RIDE_STATUSES) {
      expect(screen.queryByText(status)).not.toBeInTheDocument(); // never raw
    }
    expect(
      screen.getAllByText(formatMessage('lv', 'console.status_requested')),
    ).toHaveLength(1);
  });
});
