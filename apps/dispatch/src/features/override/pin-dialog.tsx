'use client';

import { formatMessage, type Language } from '@taxi/shared';
import { DialogShell, dialogButtonStyle } from './dialog-shell';
import type { PinState } from './use-pickup-pin';

const LANG: Language = 'lv';

/**
 * The pickup PIN, read to a phone caller whose arrival SMS never came (#275).
 *
 * The PIN is never persisted and never shown on the row: it lives as long as
 * this dialog, in `usePickupPin`'s state. The `role="status"` region is
 * mounted from the loading state on, so a screen reader speaks the digits the
 * moment they replace the loading text.
 */
export function PinDialog({
  state,
  onClose,
}: Readonly<{ state: PinState; onClose: () => void }>) {
  return (
    <DialogShell
      title={formatMessage(LANG, 'console.pin_title')}
      onClose={onClose}
    >
      {state.kind === 'error' ? (
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
          {formatMessage(LANG, state.key)}
        </p>
      ) : (
        <div role="status" style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
          {state.kind === 'shown' ? (
            <>
              <p
                style={{
                  margin: 0,
                  fontSize: 'var(--font-size-xl)',
                  fontWeight: 700,
                  letterSpacing: '0.3em',
                }}
              >
                {state.pin}
              </p>
              <p style={{ margin: 0, fontSize: 'var(--font-size-sm)' }}>
                {formatMessage(LANG, 'console.pin_hint')}
              </p>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: 'var(--font-size-sm)' }}>
              {formatMessage(LANG, 'console.loading')}
            </p>
          )}
        </div>
      )}

      <div style={{ display: 'flex' }}>
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
