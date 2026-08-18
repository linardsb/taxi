'use client';

import { formatMessage, type AddressPoint, type Language } from '@taxi/shared';
import { useEffect, useRef } from 'react';
import { DialogShell, dialogButtonStyle } from '@/features/override';
import { AddressField } from './address-field';
import { resolvePlace, searchAddress } from './booking-api';
import { CallerPanel } from './caller-panel';
import { useBookingForm } from './use-booking-form';

const LANG: Language = 'lv';

/**
 * The keyboard-first booking form (#19).
 *
 * TAB ORDER IS THE SPEC: phone → caller name → pickup → destination → payment
 * → note → book, which is the order a caller speaks in (evidence F2.4). No
 * scheduled-time field — #21 owns the promoting timer, and a control that can
 * only ever mean "now" is a tab stop that costs a keystroke and buys nothing.
 *
 * Escape closes with the draft INTACT: the draft lives in `localStorage`, not
 * in this component, so closing is never data loss.
 */
export function BookingForm({
  offline,
  onClose,
}: Readonly<{ offline: boolean; onClose: () => void }>) {
  const form = useBookingForm(offline);
  const destinationRef = useRef<HTMLDivElement>(null);

  // A venue or a past job fills the pickup, so the next thing Dina needs is the
  // destination — the focus jump is what makes the venue path a ≤15 s booking
  // rather than a fill plus a hunt for the next field.
  const prefilledFrom = form.draft.prefilledFrom;
  useEffect(() => {
    if (prefilledFrom === null) return;
    destinationRef.current
      ?.querySelector<HTMLInputElement>('input[role="combobox"]')
      ?.focus();
  }, [prefilledFrom]);

  if (form.bookedRideId !== null) {
    return (
      // A DISTINCT KEY, so React remounts the shell rather than reconciling it.
      // Both branches return `DialogShell` at the same position, so without
      // this the shell is reused, its focus effect (`[]` deps) never re-runs,
      // and the focused «Pasūtīt» unmounts under the dispatcher: focus falls to
      // `document.body`, the dialog's new `aria-label` is never announced, and
      // the next Tab restarts from the top of the document — on the screen
      // whose acceptance criterion is that it works without a mouse.
      <DialogShell
        key="booked"
        title={formatMessage(LANG, 'console.booking_created')}
        onClose={onClose}
      >
        {/* No paragraph repeating the title: `DialogShell` renders it as the
            dialog's heading AND its `aria-label`, so a second copy is read
            twice by a screen reader and adds nothing to the eye. */}
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
          <button
            type="button"
            onClick={form.reset}
            style={dialogButtonStyle('primary')}
          >
            {formatMessage(LANG, 'console.new_order')}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={dialogButtonStyle('secondary')}
          >
            {formatMessage(LANG, 'console.booking_close')}
          </button>
        </div>
      </DialogShell>
    );
  }

  return (
    <DialogShell
      key="form"
      title={formatMessage(LANG, 'console.new_order_title')}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.submit();
        }}
        style={{ display: 'grid', gap: 'var(--spacing-md)' }}
      >
        <CallerPanel
          phone={form.draft.phone}
          callerName={form.draft.callerName}
          lookup={form.lookup}
          lookupState={form.lookupState}
          venues={form.venues}
          onPhoneChange={form.setPhone}
          onCallerNameChange={form.setCallerName}
          onUseRecent={(pickup: AddressPoint, destination: AddressPoint) =>
            form.prefillFrom('recent', pickup, destination)
          }
          onPickVenue={(pickup: AddressPoint) =>
            form.prefillFrom('venue', pickup)
          }
        />

        <AddressField
          label={formatMessage(LANG, 'console.pickup')}
          value={form.draft.pickup}
          offline={offline}
          onTextChange={(text) => form.setAddressTextFor('pickup', text)}
          onResolved={(point, placeId) =>
            form.resolveAddress('pickup', point, placeId)
          }
          search={searchAddress}
          resolve={resolvePlace}
        />

        <div ref={destinationRef}>
          <AddressField
            label={formatMessage(LANG, 'console.destination')}
            value={form.draft.destination}
            offline={offline}
            onTextChange={(text) => form.setAddressTextFor('destination', text)}
            onResolved={(point, placeId) =>
              form.resolveAddress('destination', point, placeId)
            }
            search={searchAddress}
            resolve={resolvePlace}
          />
        </div>

        <fieldset
          style={{
            display: 'flex',
            gap: 'var(--spacing-sm)',
            border: 'none',
            margin: 0,
            padding: 0,
          }}
        >
          <legend style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>
            {formatMessage(LANG, 'console.payment_method')}
          </legend>
          {(['cash', 'card'] as const).map((method) => (
            <label
              key={method}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-xs)',
                minHeight: 44,
                fontSize: 'var(--font-size-sm)',
              }}
            >
              <input
                type="radio"
                name="payment-method"
                value={method}
                checked={form.draft.paymentMethod === method}
                onChange={() => form.setPaymentMethod(method)}
              />
              {formatMessage(
                LANG,
                method === 'cash'
                  ? 'console.payment_cash'
                  : 'console.payment_card',
              )}
            </label>
          ))}
        </fieldset>

        <div style={{ display: 'grid', gap: 'var(--spacing-xs)' }}>
          <label
            htmlFor="booking-note"
            style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}
          >
            {formatMessage(LANG, 'console.note')}
          </label>
          <textarea
            id="booking-note"
            value={form.draft.note}
            onChange={(event) => form.setNote(event.target.value)}
            rows={2}
            style={{
              padding: 'var(--spacing-xs) var(--spacing-sm)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
              color: 'var(--color-fg)',
              fontSize: 'var(--font-size-md)',
            }}
          />
        </div>

        {/* Always mounted, like the board's alert region — a reason that
            appears only when it exists is a reason nobody hears. */}
        <p
          role="status"
          style={{
            margin: 0,
            minHeight: '1rem',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-fg-muted)',
          }}
        >
          {/* The retry window comes from the API's own `retryAfterSeconds`,
              never a literal: the ride-request window is 600 s, so a
              hardcoded 60 would send Dina back ten times too early. */}
          {form.errorKey !== null
            ? formatMessage(LANG, form.errorKey, {
                retry: form.errorRetrySeconds ?? '—',
              })
            : offline
              ? formatMessage(LANG, 'console.booking_offline_disabled')
              : ''}
        </p>

        <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
          <button
            type="submit"
            // Disabled WITH A REASON stated above, never silently: an offline
            // console that just stops accepting orders is indistinguishable
            // from a broken one.
            disabled={!form.bookable || form.submitting}
            style={{
              ...dialogButtonStyle('primary'),
              opacity: form.bookable && !form.submitting ? 1 : 0.5,
            }}
          >
            {formatMessage(
              LANG,
              form.submitting ? 'console.booking_submitting' : 'console.book',
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={dialogButtonStyle('secondary')}
          >
            {formatMessage(LANG, 'console.booking_close')}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}
