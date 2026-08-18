'use client';

import { formatMessage, type Language, type MessageKey } from '@taxi/shared';
import { useState } from 'react';
import { DialogShell, dialogButtonStyle } from './dialog-shell';

const LANG: Language = 'lv';

/**
 * Cancel-as-dispatcher. UI-only work: `POST /rides/:rideId/cancel` already
 * accepts `dispatcher` and `admin`, and the api maps an admin actor onto
 * `cancelled_by_dispatcher` because the machine has no fifth cancel status.
 *
 * One step, not two — unlike the assign dialog there is no car to choose, and
 * the confirm IS the dialog. The destructive button is styled as such and is
 * NOT the default focus (the shell focuses the reason field first), so a
 * stray Enter on an accidentally-opened dialog cannot kill a live ride.
 */
export function CancelDialog({
  submitting,
  errorKey,
  disabledReasonKey,
  onConfirm,
  onClose,
}: Readonly<{
  submitting: boolean;
  errorKey: MessageKey | null;
  disabledReasonKey: MessageKey | null;
  onConfirm: (reason: string | null) => void;
  onClose: () => void;
}>) {
  const [reason, setReason] = useState('');

  return (
    <DialogShell
      title={formatMessage(LANG, 'console.cancel_title')}
      onClose={onClose}
    >
      {errorKey !== null && (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: 'var(--spacing-sm) var(--spacing-md)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-danger)',
            color: 'var(--color-accent-fg)',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          {formatMessage(LANG, errorKey)}
        </p>
      )}

      {disabledReasonKey !== null && (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: 'var(--spacing-sm) var(--spacing-md)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-warning)',
            color: 'var(--color-accent-fg)',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          {formatMessage(LANG, disabledReasonKey)}
        </p>
      )}

      <label style={{ display: 'grid', gap: 'var(--spacing-xs)' }}>
        <span style={{ fontSize: 'var(--font-size-sm)' }}>
          {formatMessage(LANG, 'console.cancel_reason')}
        </span>
        <textarea
          value={reason}
          maxLength={280}
          rows={2}
          onChange={(event) => setReason(event.target.value)}
          style={{
            padding: 'var(--spacing-xs) var(--spacing-sm)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
            color: 'var(--color-fg)',
            fontSize: 'var(--font-size-sm)',
            fontFamily: 'inherit',
          }}
        />
      </label>

      <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
        <button
          type="button"
          onClick={onClose}
          style={dialogButtonStyle('secondary')}
        >
          {formatMessage(LANG, 'console.cancel_keep')}
        </button>
        <button
          type="button"
          disabled={submitting || disabledReasonKey !== null}
          onClick={() => onConfirm(reason.trim() === '' ? null : reason)}
          style={{
            ...dialogButtonStyle('danger'),
            marginLeft: 'auto',
            opacity: submitting || disabledReasonKey !== null ? 0.6 : 1,
          }}
        >
          {formatMessage(LANG, 'console.cancel_confirm')}
        </button>
      </div>
    </DialogShell>
  );
}
