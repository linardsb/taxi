'use client';

import { useLayoutEffect, useRef } from 'react';
import {
  DISPLAY_NAME_MAX,
  formatMessage,
  type AddressPoint,
  type CallerLookup,
  type Language,
  type RecentRide,
  type VenueEntry,
} from '@taxi/shared';

const LANG: Language = 'lv';

const chipStyle: React.CSSProperties = {
  minHeight: 44,
  padding: 'var(--spacing-xs) var(--spacing-sm)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg-surface)',
  color: 'var(--color-fg)',
  fontSize: 'var(--font-size-sm)',
  textAlign: 'left',
  cursor: 'pointer',
};

/**
 * Caller-ID: the number Dina types, what the platform already knows about it,
 * and the one-keystroke reuses that turn a 60-second booking into a 30-second
 * one (the ledger's repeat-caller row).
 *
 * The panel is deliberately BUTTONS, not a select or a datalist: every reuse is
 * one keystroke from the tab order, and a listbox would add a mode to escape
 * from. Nothing here is mouse-only.
 */
export function CallerPanel({
  phone,
  callerName,
  lookup,
  lookupState,
  venues,
  onPhoneChange,
  onCallerNameChange,
  onUseRecent,
  onPickVenue,
}: Readonly<{
  phone: string;
  callerName: string;
  lookup: CallerLookup | null;
  lookupState: 'idle' | 'searching' | 'none' | 'failed';
  venues: VenueEntry[];
  onPhoneChange: (phone: string) => void;
  onCallerNameChange: (name: string) => void;
  onUseRecent: (pickup: AddressPoint, destination: AddressPoint) => void;
  onPickVenue: (pickup: AddressPoint) => void;
}>) {
  const label = lookup?.customer?.label ?? null;
  // The rider's own name (#269). Shown read-only: the api ignores Dina's
  // `callerName` for a named rider (D2), so an editable field would drop her
  // edit without saying so.
  const knownName = lookup?.displayName ?? null;
  const hasKnownName = knownName !== null;

  // The lookup can land while Dina is typing in the name field. The swap
  // unmounts whichever element held focus and drops it to `<body>`, outside
  // `DialogShell`'s Escape and Tab handler (#290 F1). Hand focus to the element
  // that took its place, but only when focus was actually lost: a lookup that
  // lands while she is on the phone field must not pull her off it.
  const nameSlot = useRef<HTMLElement | null>(null);
  const hadKnownName = useRef(hasKnownName);
  useLayoutEffect(() => {
    if (hadKnownName.current === hasKnownName) return;
    hadKnownName.current = hasKnownName;
    const active = document.activeElement;
    if (active === null || active === document.body) nameSlot.current?.focus();
  }, [hasKnownName]);

  return (
    <section style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
      <div style={{ display: 'grid', gap: 'var(--spacing-xs)' }}>
        <label
          htmlFor="booking-phone"
          style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}
        >
          {formatMessage(LANG, 'console.caller_phone')}
        </label>
        <input
          id="booking-phone"
          // `tel`, not `text`: it is a phone number on a keyboard-first form,
          // and the type is what a screen reader announces it as.
          type="tel"
          value={phone}
          onChange={(event) => onPhoneChange(event.target.value)}
          placeholder={formatMessage(LANG, 'console.phone_placeholder')}
          aria-describedby="booking-caller-status"
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
        {/* Always mounted: an assistive technology cannot announce a live
            region that appears with its first message. */}
        <p
          id="booking-caller-status"
          role="status"
          style={{
            margin: 0,
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-fg-muted)',
          }}
        >
          {label ??
            (lookupState === 'searching'
              ? formatMessage(LANG, 'console.caller_searching')
              : lookupState === 'none'
                ? formatMessage(LANG, 'console.caller_lookup_none')
                : lookupState === 'failed'
                  ? formatMessage(LANG, 'console.caller_lookup_failed')
                  : '')}
        </p>
      </div>

      {knownName !== null ? (
        <p
          id="booking-caller-name-known"
          ref={(node) => {
            nameSlot.current = node;
          }}
          // Focusable by script only, so it can take over from the input.
          tabIndex={-1}
          style={{ margin: 0, fontSize: 'var(--font-size-md)' }}
        >
          {formatMessage(LANG, 'console.caller_known_name', {
            name: knownName,
          })}
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--spacing-xs)' }}>
          <label
            htmlFor="booking-caller-name"
            style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}
          >
            {formatMessage(LANG, 'console.caller_name')}
          </label>
          <input
            id="booking-caller-name"
            ref={(node) => {
              nameSlot.current = node;
            }}
            value={callerName}
            // The wire caps `callerName` at the same length and refuses more
            // with a 400 (#290 F2), so the field cannot produce it.
            maxLength={DISPLAY_NAME_MAX}
            onChange={(event) => onCallerNameChange(event.target.value)}
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
        </div>
      )}

      {lookup !== null && lookup.recentRides.length > 0 ? (
        <RecentJobs rides={lookup.recentRides} onUse={onUseRecent} />
      ) : null}

      <Venues venues={venues} onPick={onPickVenue} />
    </section>
  );
}

function RecentJobs({
  rides,
  onUse,
}: Readonly<{
  rides: RecentRide[];
  onUse: (pickup: AddressPoint, destination: AddressPoint) => void;
}>) {
  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-xs)' }}>
      <h3 style={{ margin: 0, fontSize: 'var(--font-size-sm)' }}>
        {formatMessage(LANG, 'console.recent_jobs')}
      </h3>
      {rides.map((ride) => (
        <button
          key={ride.rideId}
          type="button"
          // Only the two addresses are reused. The payment method, the note and
          // the category are per-trip and are NOT prefilled — evidence F2.2.
          onClick={() => onUse(ride.pickup, ride.destination)}
          style={chipStyle}
        >
          {formatMessage(LANG, 'console.recent_job_reuse', {
            from: ride.pickup.address,
            to: ride.destination.address,
          })}
        </button>
      ))}
    </div>
  );
}

function Venues({
  venues,
  onPick,
}: Readonly<{
  venues: VenueEntry[];
  onPick: (pickup: AddressPoint) => void;
}>) {
  // A venue with no saved pickup cannot quick-book anything, so it is not
  // offered — an empty chip that fills nothing is worse than no chip.
  const bookable = venues.flatMap((entry) => {
    const pickup = entry.places.find((place) => place.kind === 'pickup');
    return pickup === undefined ? [] : [{ entry, pickup }];
  });

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-xs)' }}>
      <h3 style={{ margin: 0, fontSize: 'var(--font-size-sm)' }}>
        {formatMessage(LANG, 'console.venues')}
      </h3>
      {bookable.length === 0 ? (
        <p
          style={{
            margin: 0,
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-fg-muted)',
          }}
        >
          {formatMessage(LANG, 'console.venues_empty')}
        </p>
      ) : (
        bookable.map(({ entry, pickup }) => (
          <button
            key={entry.customer.id}
            type="button"
            onClick={() => onPick(pickup.point)}
            style={chipStyle}
          >
            {formatMessage(LANG, 'console.venue_pick', {
              name: entry.customer.label ?? pickup.point.address,
            })}
          </button>
        ))
      )}
    </div>
  );
}
