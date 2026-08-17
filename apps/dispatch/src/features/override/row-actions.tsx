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
  onAssign,
  onCancel,
}: Readonly<{
  status: BoardRideStatus;
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
        <button type="button" onClick={onAssign} style={buttonStyle(false)}>
          {formatMessage(
            LANG,
            verb === 'assign' ? 'console.assign' : 'console.reassign',
          )}
        </button>
      )}
      <button type="button" onClick={onCancel} style={buttonStyle(true)}>
        {formatMessage(LANG, 'console.cancel_ride')}
      </button>
    </span>
  );
}
