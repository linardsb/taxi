'use client';

import {
  formatMessage,
  type BoardRideStatus,
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
 */
export function RideRowActions({
  status,
  address,
  onAssign,
  onCancel,
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
  onAssign: () => void;
  onCancel: () => void;
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
