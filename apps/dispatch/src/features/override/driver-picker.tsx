'use client';

import {
  formatMessage,
  type DispatchDriver,
  type DriverStatus,
  type Language,
  type MessageKey,
} from '@taxi/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { filterRoster, sortRoster } from './assign-state';

const LANG: Language = 'lv';

const STATUS_KEY: Record<DriverStatus, MessageKey> = {
  online: 'console.driver_status_online',
  on_ride: 'console.driver_status_on_ride',
  offline: 'console.driver_status_offline',
};

const STATUS_COLOR: Record<DriverStatus, string> = {
  online: 'var(--color-success)',
  on_ride: 'var(--color-accent)',
  offline: 'var(--color-fg-muted)',
};

/**
 * Pick the car. A filter box over a listbox, driven entirely from the
 * keyboard: ↓/↑ move, Enter selects, and typing narrows.
 *
 * Deliberately NOT a `<select>`: each option carries four facts (name, status,
 * plate, zone) that a native option cannot render, and evidence F2.4's whole
 * point is that a professional dispatcher's hands stay on the keyboard — a
 * native select would be keyboard-operable but unreadable mid-call.
 *
 * NOTHING here is disabled by driver status. Every driver is selectable
 * including the offline ones; the warning is the confirm step's job. #10:
 * "overriding the algorithm — including onto an offline or otherwise
 * ineligible driver — is the feature, not a hole in it."
 */
export function DriverPicker({
  drivers,
  pickupZoneName,
  loading,
  onPick,
}: Readonly<{
  drivers: readonly DispatchDriver[];
  pickupZoneName: string | null;
  loading: boolean;
  onPick: (driver: DispatchDriver) => void;
}>) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const visible = useMemo(
    () => filterRoster(sortRoster(drivers, pickupZoneName), query),
    [drivers, pickupZoneName, query],
  );

  // Clamped rather than stored: the list shrinks as Dina types, and an index
  // left pointing past the end would make Enter do nothing with no feedback.
  const active = Math.min(activeIndex, Math.max(0, visible.length - 1));

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(Math.min(active + 1, visible.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(Math.max(active - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const picked = visible[active];
      if (picked) onPick(picked);
    }
  };

  const optionId = (index: number) => `driver-option-${index}`;

  // The listbox is ~5 options tall (320px / 44px). Without this ArrowDown moves
  // `aria-activedescendant` past the fold while the list stays put, so a
  // sighted keyboard user selects a driver they cannot see — and this is the
  // slice whose primary user never touches the mouse (#120 review M7).
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    listRef.current
      ?.querySelector(`#${CSS.escape(optionId(active))}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
      <label style={{ display: 'grid', gap: 'var(--spacing-xs)' }}>
        <span style={{ fontSize: 'var(--font-size-sm)' }}>
          {formatMessage(LANG, 'console.assign_pick_driver')}
        </span>
        <input
          type="text"
          role="combobox"
          aria-expanded={visible.length > 0}
          // Conditional for the same reason `aria-activedescendant` below is:
          // the empty state renders no listbox, and an ARIA id reference that
          // resolves to nothing is an `aria-valid-attr-value` violation
          // (#120 review L4).
          aria-controls={visible.length > 0 ? 'driver-listbox' : undefined}
          aria-activedescendant={
            visible.length > 0 ? optionId(active) : undefined
          }
          aria-autocomplete="list"
          placeholder={formatMessage(LANG, 'console.assign_filter')}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
          style={{
            minHeight: 44,
            padding: 'var(--spacing-xs) var(--spacing-sm)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
            color: 'var(--color-fg)',
            fontSize: 'var(--font-size-md)',
          }}
        />
      </label>

      {loading && (
        <p role="status" style={{ margin: 0, fontSize: 'var(--font-size-sm)' }}>
          {formatMessage(LANG, 'console.loading')}
        </p>
      )}

      {!loading && visible.length === 0 ? (
        <p
          role="status"
          style={{
            margin: 0,
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-fg-muted)',
          }}
        >
          {formatMessage(LANG, 'console.assign_no_drivers')}
        </p>
      ) : (
        <ul
          ref={listRef}
          id="driver-listbox"
          role="listbox"
          aria-label={formatMessage(LANG, 'console.assign_pick_driver')}
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gap: 'var(--spacing-xs)',
            maxHeight: 320,
            overflowY: 'auto',
          }}
        >
          {visible.map((driver, index) => (
            <li key={driver.driverId} role="none">
              <button
                type="button"
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                // -1 so Tab skips the whole list: the combobox above owns the
                // keyboard here, and 30 tab stops would be the opposite of
                // keyboard-first.
                tabIndex={-1}
                onClick={() => onPick(driver)}
                onMouseEnter={() => setActiveIndex(index)}
                style={{
                  width: '100%',
                  minHeight: 44,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--spacing-sm)',
                  padding: 'var(--spacing-xs) var(--spacing-sm)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  background:
                    index === active
                      ? 'var(--color-bg-surface)'
                      : 'var(--color-bg)',
                  outline:
                    index === active
                      ? '2px solid var(--color-accent)'
                      : undefined,
                  color: 'var(--color-fg)',
                  fontSize: 'var(--font-size-sm)',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <span
                  role="img"
                  aria-label={formatMessage(LANG, STATUS_KEY[driver.status])}
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    flexShrink: 0,
                    background: STATUS_COLOR[driver.status],
                  }}
                />
                <span style={{ fontWeight: 600 }}>{driver.name}</span>
                {driver.vehiclePlate !== null && (
                  <span style={{ color: 'var(--color-fg-muted)' }}>
                    {driver.vehiclePlate}
                  </span>
                )}
                {driver.zoneName !== null && (
                  <span style={{ color: 'var(--color-fg-muted)' }}>
                    {driver.zoneName}
                  </span>
                )}
                <span
                  style={{
                    marginLeft: 'auto',
                    color: 'var(--color-fg-muted)',
                  }}
                >
                  {driver.activeRideId !== null
                    ? formatMessage(LANG, 'console.assign_on_ride')
                    : driver.phone}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
