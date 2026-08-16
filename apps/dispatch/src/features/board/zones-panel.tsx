'use client';

import {
  formatMessage,
  type DispatchBoardEvent,
  type DriverStatus,
  type Language,
  type MessageKey,
} from '@taxi/shared';

const LANG: Language = 'lv';

type BoardDriver = DispatchBoardEvent['drivers'][number];

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

function DriverChip({ driver }: Readonly<{ driver: BoardDriver }>) {
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
      {/* The phone is ALWAYS visible — degraded mode means Dina dispatches
          by voice, and hunting for a number mid-outage is the trap. */}
      <a
        href={`tel:${driver.phone}`}
        style={{
          color: 'var(--color-fg-muted)',
          textDecoration: 'none',
          minHeight: 44,
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        {driver.phone}
      </a>
    </li>
  );
}

/**
 * Drivers grouped by geozone (#18 scope: grouping ONLY — queue positions and
 * time-in-zone are #19's). Cards exist for zones that HAVE drivers plus
 * «Ārpus zonām»; a card for every configured-but-empty zone needs a zone
 * catalog the frame doesn't carry (deferred to #19's zone/queue view).
 */
export function ZonesPanel({
  drivers,
}: Readonly<{ drivers: BoardDriver[] }>) {
  const byZone = new Map<string | null, BoardDriver[]>();
  for (const driver of drivers) {
    const key = driver.zoneName;
    byZone.set(key, [...(byZone.get(key) ?? []), driver]);
  }
  const named = [...byZone.entries()]
    .filter((e): e is [string, BoardDriver[]] => e[0] !== null)
    .sort((a, b) => a[0].localeCompare(b[0], 'lv'));
  const outside = byZone.get(null) ?? [];

  if (drivers.length === 0) {
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

  const card = (name: string, zoneDrivers: BoardDriver[]) => (
    <section
      key={name}
      style={{
        display: 'grid',
        gap: 'var(--spacing-sm)',
        padding: 'var(--spacing-md)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-border)',
        background: 'var(--color-bg-surface)',
      }}
    >
      <h3 style={{ margin: 0, fontSize: 'var(--font-size-md)' }}>
        {name} ({zoneDrivers.length})
      </h3>
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--spacing-sm)',
        }}
      >
        {zoneDrivers.map((d) => (
          <DriverChip key={d.driverId} driver={d} />
        ))}
      </ul>
    </section>
  );

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
      {named.map(([name, zoneDrivers]) => card(name, zoneDrivers))}
      {outside.length > 0 &&
        card(formatMessage(LANG, 'console.zone_none'), outside)}
    </div>
  );
}
