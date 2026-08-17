'use client';

import {
  formatMessage,
  type DispatchBoardEvent,
  type DriverStatus,
  type Language,
  type MessageKey,
} from '@taxi/shared';

const LANG: Language = 'lv';

type BoardZone = DispatchBoardEvent['zones'][number];
type ZoneEntry = BoardZone['entries'][number];

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

const cell: React.CSSProperties = {
  padding: 'var(--spacing-sm) var(--spacing-md)',
  borderBottom: '1px solid var(--color-border)',
  verticalAlign: 'top',
  textAlign: 'left',
};

/**
 * One driver's place in a rank.
 *
 * The position is rendered as digits and ALSO carried in an aria-label, so a
 * screen reader says "queue place 2" rather than "hash two" — Dina works this
 * screen eight hours a day and the a11y bar here is the rider app's.
 *
 * `queueModeEnabled: false` hides the number entirely rather than greying it:
 * a rank dispatch does not honour is worse than no rank, because it is one
 * drivers will still ring up to argue about.
 */
function QueueChip({
  entry,
  showPosition,
}: Readonly<{ entry: ZoneEntry; showPosition: boolean }>) {
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--spacing-sm)',
        padding: 'var(--spacing-xs) var(--spacing-sm)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        fontSize: 'var(--font-size-sm)',
      }}
    >
      <span
        role="img"
        aria-label={formatMessage(LANG, DRIVER_STATUS_KEY[entry.status])}
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          flexShrink: 0,
          background: DRIVER_STATUS_COLOR[entry.status],
        }}
      />
      {showPosition && (
        <span
          aria-label={formatMessage(LANG, 'console.zone_queue_position', {
            position: entry.position,
          })}
          style={{
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 700,
            color: 'var(--color-accent)',
          }}
        >
          {entry.position}
        </span>
      )}
      <span style={{ fontWeight: 600 }}>{entry.name}</span>
      <span
        style={{
          color: 'var(--color-fg-muted)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {formatMessage(LANG, 'console.zone_time', {
          minutes: Math.floor(entry.secondsInZone / 60),
        })}
      </span>
      {/* The phone is ALWAYS visible — degraded mode means Dina dispatches
          by voice, and hunting for a number mid-outage is the trap. */}
      <a
        href={`tel:${entry.phone}`}
        style={{
          color: 'var(--color-fg-muted)',
          textDecoration: 'none',
          minHeight: 44,
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        {entry.phone}
      </a>
    </li>
  );
}

function ZoneRow({ zone }: Readonly<{ zone: BoardZone }>) {
  return (
    <tr>
      <th scope="row" style={{ ...cell, fontWeight: 600 }}>
        {zone.name}
        <span
          style={{
            display: 'block',
            fontWeight: 400,
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-fg-muted)',
          }}
        >
          {zone.slug}
        </span>
      </th>
      <td
        style={{
          ...cell,
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-fg-muted)',
          whiteSpace: 'nowrap',
        }}
      >
        {formatMessage(
          LANG,
          zone.queueModeEnabled
            ? 'console.zone_queue_mode'
            : 'console.zone_queue_mode_off',
        )}
      </td>
      <td style={cell}>
        {zone.entries.length === 0 ? (
          <span
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-fg-muted)',
            }}
          >
            {formatMessage(LANG, 'console.zone_empty')}
          </span>
        ) : (
          <ol
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--spacing-sm)',
            }}
          >
            {zone.entries.map((entry) => (
              <QueueChip
                key={entry.driverId}
                entry={entry}
                showPosition={zone.queueModeEnabled}
              />
            ))}
          </ol>
        )}
      </td>
    </tr>
  );
}

/**
 * The zone/queue grid — Dina's PRIMARY work surface, map secondary (evidence
 * F1.1, `apps/dispatch/CLAUDE.md`). Replaces `board/zones-panel.tsx`, which
 * grouped drivers by the polygon they were standing in and could show neither
 * a queue position nor a time, and could not draw a zone nobody was in.
 *
 * A real `<table>`, not a grid of cards: this IS tabular — one row per zone,
 * compared down a column — and the semantics buy the row/column announcements
 * for free.
 *
 * Every configured zone appears, empty ones included, because an empty rank is
 * the answer to "where do I send the next free car".
 */
export function ZoneGrid({ zones }: Readonly<{ zones: BoardZone[] }>) {
  if (zones.length === 0) {
    return (
      <p
        style={{
          margin: 0,
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-fg-muted)',
        }}
      >
        {formatMessage(LANG, 'console.zone_empty')}
      </p>
    );
  }

  return (
    <table
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        background: 'var(--color-bg-surface)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-border)',
      }}
    >
      <thead>
        <tr>
          {(
            [
              'console.zone_col_zone',
              'console.zone_col_mode',
              'console.zone_col_queue',
            ] as const
          ).map((key) => (
            <th
              key={key}
              scope="col"
              style={{
                ...cell,
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-fg-muted)',
                textTransform: 'uppercase',
              }}
            >
              {formatMessage(LANG, key)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {zones.map((zone) => (
          <ZoneRow key={zone.geozoneId} zone={zone} />
        ))}
      </tbody>
    </table>
  );
}
