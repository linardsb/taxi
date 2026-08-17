'use client';

import {
  formatMessage,
  type DispatchDriver,
  type Language,
  type MessageKey,
} from '@taxi/shared';
import { useState } from 'react';
import type { AssignVerb } from './assign-state';
import { driverWarning, warningKey } from './assign-state';
import { DialogShell, dialogButtonStyle } from './dialog-shell';
import { DriverPicker } from './driver-picker';

const LANG: Language = 'lv';

/**
 * Dina's override, in two steps: pick the car, then confirm it.
 *
 * The second step exists ONLY because of what step one is allowed to offer.
 * Force-assign is documented as not filtered through the eligibility rules, so
 * the picker lists offline and busy drivers — and a one-click assign onto a
 * driver whose app is dead would be a mis-click with a real car behind it. The
 * confirm is where the warning lands.
 *
 * It is a WARNING, not a block. The ticket's AC asks for "a clear error" when
 * assigning a just-went-offline driver; #10 built the opposite deliberately,
 * and the console honours the api rather than faking an error it will not
 * produce. The real error is the 409 below, when the ride moved on mid-cascade
 * — and the cascade resuming is itself the re-offer that AC asks for.
 */
export function AssignDialog({
  verb,
  pickupZoneName,
  drivers,
  loadingRoster,
  submitting,
  errorKey,
  disabledReasonKey,
  onSubmit,
  onClearError,
  onClose,
}: Readonly<{
  verb: AssignVerb;
  pickupZoneName: string | null;
  drivers: readonly DispatchDriver[];
  loadingRoster: boolean;
  submitting: boolean;
  errorKey: MessageKey | null;
  /** Set while the console is offline — the write is refused WITH a reason. */
  disabledReasonKey: MessageKey | null;
  onSubmit: (driverId: string, reason: string | null) => void;
  /** Drops the last error, so picking again leaves the failed attempt behind. */
  onClearError: () => void;
  onClose: () => void;
}>) {
  const [picked, setPicked] = useState<DispatchDriver | null>(null);
  const [reason, setReason] = useState('');

  /**
   * A failed submit returns to the picker rather than stranding Dina on a
   * confirm screen for a driver who can no longer take the ride — the board's
   * next frame (≤2 s) has already changed under her.
   *
   * DERIVED, not an effect that clears `picked`: setState inside an effect
   * cascades a second render, and the step is a pure function of two things we
   * already have. Picking again clears the error, which flips this back.
   */
  const showPicker = picked === null || errorKey !== null;

  const title = formatMessage(
    LANG,
    verb === 'assign' ? 'console.assign_title' : 'console.reassign_title',
  );
  const warning = picked === null ? null : driverWarning(picked);

  return (
    // The step swap unmounts whichever half held focus, so the shell has to be
    // told a step changed — see its docblock.
    <DialogShell
      title={title}
      // Same condition as the render below, deliberately: the key has to change
      // exactly when the rendered step does, including the failed-submit return
      // to the picker (`picked` is still set, but the picker is what is shown).
      focusKey={showPicker || picked === null ? 'picker' : picked.driverId}
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

      {/* The `|| picked === null` looks redundant — `showPicker` already
          covers it — but it is what narrows `picked` to non-null in the else
          branch. Removing it is a type error, not a simplification. */}
      {showPicker || picked === null ? (
        <DriverPicker
          drivers={drivers}
          pickupZoneName={pickupZoneName}
          loading={loadingRoster}
          onPick={(driver) => {
            setPicked(driver);
            onClearError();
          }}
        />
      ) : (
        <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
          <p style={{ margin: 0, fontSize: 'var(--font-size-md)' }}>
            <strong>{picked.name}</strong>
            {picked.vehiclePlate !== null && ` · ${picked.vehiclePlate}`}
          </p>

          {warning !== null && (
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
              {formatMessage(LANG, warningKey(warning), { name: picked.name })}
            </p>
          )}

          <label style={{ display: 'grid', gap: 'var(--spacing-xs)' }}>
            <span style={{ fontSize: 'var(--font-size-sm)' }}>
              {formatMessage(LANG, 'console.assign_reason')}
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
              onClick={() => setPicked(null)}
              style={dialogButtonStyle('secondary')}
            >
              {formatMessage(LANG, 'console.assign_back')}
            </button>
            <button
              type="button"
              disabled={submitting || disabledReasonKey !== null}
              onClick={() =>
                onSubmit(picked.driverId, reason.trim() === '' ? null : reason)
              }
              style={{
                ...dialogButtonStyle('primary'),
                marginLeft: 'auto',
                opacity: submitting || disabledReasonKey !== null ? 0.6 : 1,
              }}
            >
              {formatMessage(
                LANG,
                submitting
                  ? 'console.assign_submitting'
                  : 'console.assign_confirm',
              )}
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onClose}
        style={{ ...dialogButtonStyle('secondary'), justifySelf: 'start' }}
      >
        {formatMessage(LANG, 'console.assign_cancel')}
      </button>
    </DialogShell>
  );
}
