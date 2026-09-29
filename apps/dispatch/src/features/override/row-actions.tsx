'use client';

import {
  formatMessage,
  type BoardRideStatus,
  type BookingChannel,
  type Language,
} from '@taxi/shared';
import { assignVerb } from './assign-state';

const LANG: Language = 'lv';

/**
 * The action cluster on a board row. It lives in the OVERRIDE slice, not in
 * `ride-queue.tsx`, so the board slice keeps owning "what is happening" and
 * this one owns "what Dina can do about it" — and so the ride queue stays
 * inside the 500-line cap as rows gain affordances.
 *
 * A row whose status takes no verb (`arrived`, `in_progress`) renders the
 * assign button not at all rather than a disabled one: a driver already at the
 * pickup is not reassignable, and a greyed control invites a click that can
 * only ever 409. Cancel stays available on every live row — a dispatcher can
 * always kill a ride.
 *
 * «Rādīt PIN» (#275) appears only on a PHONE PIN ride at `arrived`: the
 * arrival SMS is the phone caller's only copy of the PIN and is sent there, so
 * before it there is nothing to recover, and the api would 409. An app rider
 * has the PIN on screen and gets no SMS, so their row never offers it (PR #300
 * M1). It goes FIRST in the cluster, because at `arrived` it is the action
 * that saves the ride.
 */
export function RideRowActions({
  status,
  address,
  bookingChannel,
  pickupPinRequired,
  onAssign,
  onCancel,
  onShowPin,
}: Readonly<{
  status: BoardRideStatus;
  /**
   * The row's pickup, for the buttons' accessible names (#120 review M6). A
   * 12-ride board otherwise gives a screen-reader user twelve buttons called
   * «Piešķirt» and twelve «Atcelt braucienu»: the `<li>` text that tells them
   * apart is announced in browse mode, not while tabbing, and tabbing is the
   * mode this slice is built for. Cancelling the wrong ride is the failure.
   */
  address: string;
  bookingChannel: BookingChannel;
  /** Whether the ride has a PIN (#275) — never the PIN itself. */
  pickupPinRequired: boolean;
  onAssign: () => void;
  onCancel: () => void;
  onShowPin: () => void;
}>) {
  const verb = assignVerb(status);

  const buttonStyle = (danger: boolean): React.CSSProperties => ({
    minHeight: 44,
    padding: 'var(--spacing-xs) var(--spacing-md)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    background: danger ? 'transparent' : 'var(--color-bg)',
    color: danger ? 'var(--color-danger)' : 'var(--color-fg)',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 600,
    cursor: 'pointer',
  });

  return (
    <span style={{ display: 'flex', gap: 'var(--spacing-xs)' }}>
      {status === 'arrived' &&
        bookingChannel === 'phone' &&
        pickupPinRequired && (
          <button
            type="button"
            onClick={onShowPin}
            aria-label={formatMessage(LANG, 'console.show_pin_at', { address })}
            style={buttonStyle(false)}
          >
            {formatMessage(LANG, 'console.show_pin')}
          </button>
        )}
      {verb !== null && (
        <button
          type="button"
          onClick={onAssign}
          aria-label={formatMessage(
            LANG,
            verb === 'assign'
              ? 'console.assign_ride_at'
              : 'console.reassign_ride_at',
            { address },
          )}
          style={buttonStyle(false)}
        >
          {formatMessage(
            LANG,
            verb === 'assign' ? 'console.assign' : 'console.reassign',
          )}
        </button>
      )}
      <button
        type="button"
        onClick={onCancel}
        aria-label={formatMessage(LANG, 'console.cancel_ride_at', { address })}
        style={buttonStyle(true)}
      >
        {formatMessage(LANG, 'console.cancel_ride')}
      </button>
    </span>
  );
}
