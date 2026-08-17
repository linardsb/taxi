'use client';

import {
  ACTIVE_DRIVER_RIDE_STATUSES,
  formatMessage,
  type BoardRideStatus,
  type DispatchBoardEvent,
  type Language,
  type MessageKey,
  type RideStatus,
} from '@taxi/shared';
import { RideRowActions } from '@/features/override';

const LANG: Language = 'lv';

type BoardRide = DispatchBoardEvent['rides'][number];

/**
 * TOTAL over `BoardRideStatus`, not `Partial<Record<RideStatus, …>>`. The api
 * decides what the board carries via `BOARD_LIVE_RIDE_STATUSES`; a `Partial`
 * let the console restate that set by hand, so adding a status there — the
 * scheduled-rides work is the named case — would return rides the query
 * serves, the wire schema accepts (`z.enum(RIDE_STATUSES)` is the full set),
 * and this file matches against no bucket: work silently missing from Dina's
 * board with typecheck, lint and every component test green. Total, the
 * omission is a build failure in both packages.
 */
const STATUS_KEY: Record<BoardRideStatus, MessageKey> = {
  requested: 'console.status_requested',
  offered: 'console.status_offered',
  queued: 'console.status_queued',
  accepted: 'console.status_accepted',
  arriving: 'console.status_arriving',
  arrived: 'console.status_arrived',
  in_progress: 'console.status_in_progress',
};

const STATUS_COLOR: Record<BoardRideStatus, string> = {
  requested: 'var(--color-warning)',
  offered: 'var(--color-accent)',
  queued: 'var(--color-accent)',
  accepted: 'var(--color-success)',
  arriving: 'var(--color-success)',
  arrived: 'var(--color-success)',
  in_progress: 'var(--color-success)',
};

const ACTIVE = new Set<RideStatus>(ACTIVE_DRIVER_RIDE_STATUSES);

/** mm:ss since the ride was requested — digits only, no words to translate. */
function ageOf(nowMs: number, requestedAt: string): string {
  const totalSeconds = Math.max(
    0,
    Math.floor((nowMs - Date.parse(requestedAt)) / 1000),
  );
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function RideRow({
  ride,
  nowMs,
  flash,
  onAssign,
  onCancel,
}: Readonly<{
  ride: BoardRide;
  nowMs: number;
  flash: boolean;
  onAssign: (ride: BoardRide) => void;
  onCancel: (ride: BoardRide) => void;
}>) {
  return (
    <li
      className={flash ? 'console-flash' : undefined}
      style={{
        display: 'grid',
        gap: 'var(--spacing-xs)',
        padding: 'var(--spacing-sm) var(--spacing-md)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        background: 'var(--color-bg-surface)',
      }}
    >
      <span style={{ fontSize: 'var(--font-size-md)', fontWeight: 600 }}>
        {ride.pickup.address}
      </span>
      <span
        style={{
          display: 'flex',
          gap: 'var(--spacing-sm)',
          alignItems: 'baseline',
          fontSize: 'var(--font-size-sm)',
        }}
      >
        {/* Status recolors IN PLACE on progress — never a toast (ISA-18.2). */}
        {/* No fallback: the map is total over what the wire can carry, so a
            raw English enum can never reach an LV-only console. */}
        <span style={{ color: STATUS_COLOR[ride.status], fontWeight: 600 }}>
          {formatMessage(LANG, STATUS_KEY[ride.status])}
        </span>
        {ride.driverName !== null && <span>{ride.driverName}</span>}
        <span style={{ color: 'var(--color-fg-muted)' }}>
          {ageOf(nowMs, ride.requestedAt)}
        </span>
      </span>
      {/* The override slice owns what Dina can DO to a row; this slice owns
          what the row says. See override/row-actions.tsx. */}
      <RideRowActions
        status={ride.status}
        onAssign={() => onAssign(ride)}
        onCancel={() => onCancel(ride)}
      />
    </li>
  );
}

function Bucket({
  title,
  rides,
  nowMs,
  flashRideIds,
  onAssign,
  onCancel,
}: Readonly<{
  title: string;
  rides: BoardRide[];
  nowMs: number;
  flashRideIds: ReadonlySet<string>;
  onAssign: (ride: BoardRide) => void;
  onCancel: (ride: BoardRide) => void;
}>) {
  return (
    <section style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
      <h3
        style={{
          margin: 0,
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-fg-muted)',
          textTransform: 'uppercase',
        }}
      >
        {title} ({rides.length})
      </h3>
      {rides.length === 0 ? (
        <p
          style={{
            margin: 0,
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-fg-muted)',
          }}
        >
          {formatMessage(LANG, 'console.empty_queue')}
        </p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gap: 'var(--spacing-sm)',
          }}
        >
          {rides.map((ride) => (
            <RideRow
              key={ride.rideId}
              ride={ride}
              nowMs={nowMs}
              flash={flashRideIds.has(ride.rideId)}
              onAssign={onAssign}
              onCancel={onCancel}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The ride queue, bucketed requested / offered+queued / active. Flash is
 * driven by ACTIVE UNCLAIMED ALERTS (S9-4), not by mere age — every fresh
 * request has unclaimedSeconds > 0 and flashing them all would bury the one
 * that matters (the alarm-budget rule).
 */
export function RideQueue({
  rides,
  nowMs,
  flashRideIds,
  onAssign,
  onCancel,
}: Readonly<{
  rides: BoardRide[];
  nowMs: number;
  flashRideIds: ReadonlySet<string>;
  onAssign: (ride: BoardRide) => void;
  onCancel: (ride: BoardRide) => void;
}>) {
  const requested = rides.filter((r) => r.status === 'requested');
  const offered = rides.filter(
    (r) => r.status === 'offered' || r.status === 'queued',
  );
  const active = rides.filter((r) => ACTIVE.has(r.status));

  const bucket = (title: MessageKey, bucketRides: BoardRide[]) => (
    <Bucket
      title={formatMessage(LANG, title)}
      rides={bucketRides}
      nowMs={nowMs}
      flashRideIds={flashRideIds}
      onAssign={onAssign}
      onCancel={onCancel}
    />
  );

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-lg)' }}>
      {bucket('console.queue_requested', requested)}
      {bucket('console.queue_offered', offered)}
      {bucket('console.queue_active', active)}
    </div>
  );
}
