'use client';

import {
  CANCEL_REASONS,
  REASON_LABEL_KEYS,
  formatMessage,
  reasonNeedsText,
  type CancelReasonCode,
  type Language,
  type MessageKey,
} from '@taxi/shared';
import { useRef, useState } from 'react';
import { DialogShell, dialogButtonStyle } from './dialog-shell';

const LANG: Language = 'lv';

/** Admin cancels use the dispatcher list too — the api maps admin onto it. */
const CONSOLE_REASONS: readonly CancelReasonCode[] = CANCEL_REASONS.dispatcher;

/** The vehicle-editor select's look (44px), copied rather than imported across slices. */
const controlStyle: React.CSSProperties = {
  minHeight: 44,
  padding: 'var(--spacing-xs) var(--spacing-sm)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg)',
  color: 'var(--color-fg)',
  fontSize: 'var(--font-size-sm)',
  fontFamily: 'inherit',
};

const fieldErrorStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--color-danger)',
  fontSize: 'var(--font-size-sm)',
};

/**
 * Cancel-as-dispatcher. UI-only work: `POST /rides/:rideId/cancel` already
 * accepts `dispatcher` and `admin`, and the api maps an admin actor onto
 * `cancelled_by_dispatcher` because the machine has no fifth cancel status.
 *
 * One step, not two — unlike the assign dialog there is no car to choose, and
 * the confirm IS the dialog. The destructive button is styled as such and is
 * NOT the default focus (the shell focuses the reason picker first), so a
 * stray Enter on an accidentally-opened dialog cannot kill a live ride.
 *
 * #316 (K2): the reason is REQUIRED and stored on the ride's protected history.
 * Nothing is preselected — a default would record a reason nobody gave. Confirm
 * stays enabled; pressing it without a reason explains why instead of greying
 * out silently. An `*_other` reason needs the note (D2).
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
  onConfirm: (body: {
    reasonCode: CancelReasonCode;
    reasonText: string | null;
  }) => void;
  onClose: () => void;
}>) {
  const [reasonCode, setReasonCode] = useState<CancelReasonCode | ''>('');
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState<'code' | 'note' | null>(null);
  const codeRef = useRef<HTMLSelectElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const blocked = submitting || disabledReasonKey !== null;

  const confirm = () => {
    if (reasonCode === '') {
      setMissing('code');
      codeRef.current?.focus();
      return;
    }
    const text = reason.trim() === '' ? null : reason.trim();
    if (reasonNeedsText(reasonCode) && text === null) {
      setMissing('note');
      noteRef.current?.focus();
      return;
    }
    setMissing(null);
    onConfirm({ reasonCode, reasonText: text });
  };

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

      <div style={{ display: 'grid', gap: 'var(--spacing-xs)' }}>
        <label
          htmlFor="cancel-reason-code"
          style={{ fontSize: 'var(--font-size-sm)' }}
        >
          {formatMessage(LANG, 'console.cancel_reason_code')}
        </label>
        <select
          id="cancel-reason-code"
          ref={codeRef}
          required
          aria-required="true"
          aria-invalid={missing === 'code'}
          aria-describedby={
            missing === 'code' ? 'cancel-reason-error' : undefined
          }
          value={reasonCode}
          onChange={(event) => {
            setReasonCode(event.target.value as CancelReasonCode);
            if (missing === 'code') setMissing(null);
          }}
          style={controlStyle}
        >
          <option value="" disabled>
            {formatMessage(LANG, 'console.cancel_reason_placeholder')}
          </option>
          {CONSOLE_REASONS.map((code) => (
            <option key={code} value={code}>
              {formatMessage(LANG, REASON_LABEL_KEYS[code])}
            </option>
          ))}
        </select>
        {missing === 'code' && (
          <p id="cancel-reason-error" role="alert" style={fieldErrorStyle}>
            {formatMessage(LANG, 'console.cancel_reason_required')}
          </p>
        )}
      </div>

      <div style={{ display: 'grid', gap: 'var(--spacing-xs)' }}>
        <label
          htmlFor="cancel-reason-note"
          style={{ fontSize: 'var(--font-size-sm)' }}
        >
          {formatMessage(LANG, 'console.cancel_reason')}
        </label>
        <textarea
          id="cancel-reason-note"
          ref={noteRef}
          value={reason}
          maxLength={280}
          rows={2}
          placeholder={formatMessage(LANG, 'console.cancel_note_placeholder')}
          aria-invalid={missing === 'note'}
          aria-describedby={
            missing === 'note' ? 'cancel-note-error' : undefined
          }
          onChange={(event) => {
            setReason(event.target.value);
            if (missing === 'note') setMissing(null);
          }}
          style={{ ...controlStyle, minHeight: undefined }}
        />
        {missing === 'note' && (
          <p id="cancel-note-error" role="alert" style={fieldErrorStyle}>
            {formatMessage(LANG, 'console.cancel_note_required')}
          </p>
        )}
      </div>

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
          disabled={blocked}
          aria-busy={submitting}
          onClick={confirm}
          style={{
            ...dialogButtonStyle('danger'),
            marginLeft: 'auto',
            opacity: blocked ? 0.6 : 1,
          }}
        >
          {formatMessage(LANG, 'console.cancel_confirm')}
        </button>
      </div>
    </DialogShell>
  );
}
