'use client';

import {
  formatMessage,
  type DispatchBoardEvent,
  type DriverStatus,
  type Language,
  type MessageKey,
} from '@taxi/shared';
import { ageOf } from './age';
import { driverFreshness, type DriverFreshness } from './board-state';

const LANG: Language = 'lv';

type BoardDriver = DispatchBoardEvent['drivers'][number];

/**
 * Restated rather than imported from `zone-grid.tsx`: that map is
 * module-private to the ZONES slice, and reaching across a slice boundary for
 * a label map costs more than four lines do. Total over `DriverStatus`, so
 * adding a status is a build failure here rather than a blank cell.
 */
const DRIVER_STATUS_KEY: Record<DriverStatus, MessageKey> = {
  online: 'console.driver_status_online',
  on_ride: 'console.driver_status_on_ride',
  offline: 'console.driver_status_offline',
};

const DRIVER_STATUS_COLOR: Record<DriverStatus, string> = {
  online: 'var(--color-success)',
  on_ride: 'var(--color-accent)',
  offline: 'var(--color-fg-muted)',
};

/** Total over the union — a fourth state cannot ship without a string. */
const FRESHNESS_KEY: Record<DriverFreshness, MessageKey> = {
  live: 'console.driver_streaming',
  stale: 'console.driver_silent',
  unknown: 'console.driver_no_signal',
};

/**
 * Colour is carried IN ADDITION TO the label, never instead of it. The label
 * is a full word in every state, so the row survives being read aloud, printed
 * in greyscale, or seen by someone who cannot separate green from amber —
 * which is what #234 AC #2 means by "not colour alone".
 */
const FRESHNESS_COLOR: Record<DriverFreshness, string> = {
  live: 'var(--color-success)',
  stale: 'var(--color-warning)',
  unknown: 'var(--color-fg-muted)',
};

const row: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: 'var(--spacing-sm)',
  padding: 'var(--spacing-xs) var(--spacing-sm)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg-surface)',
  fontSize: 'var(--font-size-sm)',
};

/** A driver the board can see, and whether their app is still reporting. */
function DriverRow({
  driver,
  nowMs,
}: Readonly<{ driver: BoardDriver; nowMs: number }>) {
  const freshness = driverFreshness(nowMs, driver.lastSeenAt);
  return (
    <li style={row}>
      {/* role="img" takes a name; a bare span maps to `generic`, which ARIA
          1.2 puts in the name-PROHIBITED set (see zone-grid.tsx). */}
      <span
        role="img"
        aria-label={formatMessage(LANG, DRIVER_STATUS_KEY[driver.status])}
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          flexShrink: 0,
          background: DRIVER_STATUS_COLOR[driver.status],
        }}
      />
      <span style={{ fontWeight: 600 }}>{driver.name}</span>
      <span style={{ color: 'var(--color-fg-muted)' }}>{driver.phone}</span>
      {driver.zoneName !== null && (
        <span style={{ color: 'var(--color-fg-muted)' }}>
          {driver.zoneName}
        </span>
      )}
      <span
        style={{
          marginLeft: 'auto',
          fontWeight: 600,
          color: FRESHNESS_COLOR[freshness],
        }}
      >
        {formatMessage(LANG, FRESHNESS_KEY[freshness], {
          // Only `console.driver_silent` carries {age}; the other two ignore
          // the extra param, so one call site serves all three states.
          age: driver.lastSeenAt === null ? '' : ageOf(nowMs, driver.lastSeenAt),
        })}
      </span>
    </li>
  );
}

/**
 * The board's driver list — and the first production reader of the
 * `lastSeenAt` that `applyDriverLocation` has been folding in all along
 * (#234).
 *
 * WHY THIS PANEL EXISTS RATHER THAN A PIN DECORATION. `frame.drivers` had one
 * consumer, `BoardMap`, whose container is `aria-hidden` and which is not even
 * mounted in the default zones view. So the board rendered position and no
 * freshness, and a parked driver looked exactly like one whose phone had died
 * — the driver app streams a fix every 4 s whether or not the vehicle moves.
 * The page mounts this OUTSIDE the zones/map toggle on purpose; putting it in
 * either branch would restate the defect for the other view.
 *
 * ONE LIVE REGION, NAMING THE SILENT DRIVERS. It is rendered at all times with
 * changing text rather than mounted when something goes wrong: a region
 * inserted at the same moment its content appears is unreliably announced.
 * Its text changes only when the SET changes, so the announcement is the
 * fresh→silent transition and never the per-second tick — the `mm:ss` stays
 * out of it deliberately (`tracking-map.tsx` states the same rule). Polite and
 * silent: `AlertsPanel` owns the audible budget, and a quiet driver is a
 * condition to read, not an alarm to buzz.
 */
export function DriverList({
  drivers,
  nowMs,
}: Readonly<{ drivers: BoardDriver[]; nowMs: number }>) {
  const silent = drivers.filter(
    (d) => driverFreshness(nowMs, d.lastSeenAt) !== 'live',
  );

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
        {formatMessage(LANG, 'console.drivers_title')} ({drivers.length})
      </h3>

      <p
        aria-live="polite"
        style={{
          margin: 0,
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-warning)',
          fontWeight: 600,
        }}
      >
        {silent.length === 0
          ? ''
          : formatMessage(LANG, 'console.drivers_silent_summary', {
              names: silent.map((d) => d.name).join(', '),
            })}
      </p>

      {drivers.length === 0 ? (
        <p
          style={{
            margin: 0,
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-fg-muted)',
          }}
        >
          {formatMessage(LANG, 'console.drivers_empty')}
        </p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gap: 'var(--spacing-xs)',
          }}
        >
          {drivers.map((driver) => (
            <DriverRow key={driver.driverId} driver={driver} nowMs={nowMs} />
          ))}
        </ul>
      )}
    </section>
  );
}
