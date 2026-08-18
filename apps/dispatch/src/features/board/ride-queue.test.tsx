import {
  BOARD_LIVE_RIDE_STATUSES,
  dispatchBoardEventSchema,
  formatMessage,
  type DispatchBoardEvent,
} from '@taxi/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

/** #19 threads two callbacks through; tests that don't exercise them say so. */
const noop = () => undefined;

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
        onAssign={noop}
        onCancel={noop}
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
    render(
      <RideQueue
        rides={[]}
        nowMs={NOW}
        flashRideIds={none}
        onAssign={noop}
        onCancel={noop}
      />,
    );
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
        onAssign={noop}
        onCancel={noop}
      />,
    );

    const flashed = screen.getByText('Brīvības 1').closest('li');
    const calm = screen.getByText('Hanzas 3').closest('li');
    expect(flashed).toHaveClass('console-flash');
    expect(calm).not.toHaveClass('console-flash');
  });

  it('offers the right verb per row and reports the ride back (#19, expected)', () => {
    const onAssign = vi.fn();
    const onCancel = vi.fn();
    render(
      <RideQueue
        rides={[
          ride({}),
          ride({
            rideId: '4f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c',
            status: 'accepted',
            driverId: 'd0000000-0000-4000-8000-000000000001',
            driverName: 'Jānis Ozols',
            pickup: {
              location: { lat: 56.96, lng: 24.12 },
              address: 'Hanzas 3',
            },
            unclaimedSeconds: 0,
          }),
        ]}
        nowMs={NOW}
        flashRideIds={none}
        onAssign={onAssign}
        onCancel={onCancel}
      />,
    );

    // An unassigned ride gets «Piešķirt»; one with a car gets the reassign verb.
    //
    // Queried by ACCESSIBLE NAME, which carries the pickup: on a real board
    // every row's buttons would otherwise be called the same thing, and a
    // screen-reader user tabbing between them could not tell which ride they
    // were about to cancel (#120 review M6). That the query needs the address
    // to disambiguate here is the point.
    fireEvent.click(
      screen.getByRole('button', { name: 'Piešķirt braucienu — Brīvības 1' }),
    );
    expect(onAssign).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'requested' }),
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Piešķirt atkārtoti braucienu — Hanzas 3',
      }),
    );
    expect(onAssign).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'accepted' }),
    );

    // Two cancel buttons, and no two share a name.
    const cancels = screen.getAllByRole('button', { name: /^Atcelt braucienu/ });
    expect(cancels).toHaveLength(2);
    expect(new Set(cancels.map((b) => b.getAttribute('aria-label'))).size).toBe(
      2,
    );

    // The VISIBLE label stays short — the address lives in the accessible name.
    expect(cancels[0]).toHaveTextContent('Atcelt braucienu');
  });

  it('offers no assign verb once the driver has reached the ride (#19, edge)', () => {
    render(
      <RideQueue
        rides={[
          ride({
            status: 'arrived',
            driverId: 'd0000000-0000-4000-8000-000000000001',
            driverName: 'Jānis Ozols',
            unclaimedSeconds: 0,
          }),
        ]}
        nowMs={NOW}
        flashRideIds={none}
        onAssign={noop}
        onCancel={noop}
      />,
    );

    // The api refuses it (RELEASABLE_STATUSES), so no button — a disabled one
    // would invite a click that can only 409. Cancel stays: a dispatcher can
    // always kill a ride.
    expect(
      screen.queryByRole('button', { name: /^Piešķirt atkārtoti/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Atcelt braucienu — Brīvības 1' }),
    ).toBeInTheDocument();
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
        onAssign={noop}
        onCancel={noop}
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
