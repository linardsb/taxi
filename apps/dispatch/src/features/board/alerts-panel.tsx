'use client';

import {
  formatMessage,
  type Language,
  type MessageKey,
} from '@taxi/shared';
import { useEffect, useRef, useState } from 'react';
import type { BoardAlert } from './board-state';

const LANG: Language = 'lv';

const SMS_KIND_KEY: Record<string, MessageKey> = {
  booking_confirmed: 'console.sms_kind_booking_confirmed',
  driver_assigned: 'console.sms_kind_driver_assigned',
  driver_arrived: 'console.sms_kind_driver_arrived',
};

function alertText(alert: BoardAlert): string {
  switch (alert.kind) {
    case 'unclaimed':
      return `${formatMessage(LANG, 'console.alert_unclaimed')} — ${alert.address}`;
    case 'sms_failed':
      return formatMessage(LANG, 'console.alert_sms_failed', {
        kind: formatMessage(
          LANG,
          SMS_KIND_KEY[alert.smsKind] ?? 'console.alert_sms_failed',
        ),
      });
    case 'offline':
      return formatMessage(LANG, 'console.alert_offline');
  }
}

/** ~200 ms oscillator — the whole "alert sound" (anything richer → #19+). */
function beep(ctx: AudioContext): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.frequency.value = 880;
  gain.gain.value = 0.05;
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.2);
}

/**
 * Action-required alerts only (ISA-18.2 discipline): unclaimed, sms_failed,
 * went-offline. Ride-progress recolors in the queue and never lands here.
 * The beep is muted by default — browsers block audio before a user gesture,
 * so the unmute CLICK is also the AudioContext unlock.
 */
export function AlertsPanel({
  alerts,
  ack,
}: Readonly<{ alerts: BoardAlert[]; ack: (id: string) => void }>) {
  const [muted, setMuted] = useState(true);
  const audioCtx = useRef<AudioContext | null>(null);
  const lastSeenId = useRef<string | null>(null);

  // Beep once per NEW newest-alert, never on re-render or acknowledge.
  const newestId = alerts[0]?.id ?? null;
  useEffect(() => {
    const isNew = newestId !== null && newestId !== lastSeenId.current;
    lastSeenId.current = newestId;
    if (isNew && !muted && audioCtx.current) beep(audioCtx.current);
  }, [newestId, muted]);

  function toggleMute() {
    if (muted && audioCtx.current === null && 'AudioContext' in window) {
      audioCtx.current = new AudioContext(); // this click IS the unlock gesture
    }
    setMuted((m) => !m);
  }

  return (
    <section style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
        }}
      >
        <button
          type="button"
          onClick={toggleMute}
          aria-pressed={!muted}
          style={{
            minHeight: 44,
            padding: 'var(--spacing-xs) var(--spacing-md)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg-surface)',
            color: 'var(--color-fg)',
            fontSize: 'var(--font-size-sm)',
            cursor: 'pointer',
          }}
        >
          {formatMessage(
            LANG,
            muted ? 'console.alerts_muted' : 'console.alerts_unmuted',
          )}
        </button>
      </div>

      {alerts.length > 0 && (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gap: 'var(--spacing-sm)',
          }}
        >
          {alerts.map((alert) => (
            <li
              key={alert.id}
              role="alert"
              className="console-flash"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--spacing-md)',
                padding: 'var(--spacing-sm) var(--spacing-md)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-danger)',
                background: 'var(--color-bg-surface)',
                fontSize: 'var(--font-size-sm)',
              }}
            >
              <span>{alertText(alert)}</span>
              <button
                type="button"
                onClick={() => ack(alert.id)}
                style={{
                  minHeight: 44,
                  minWidth: 44,
                  padding: 'var(--spacing-xs) var(--spacing-md)',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: 'var(--color-accent)',
                  color: 'var(--color-accent-fg)',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                {formatMessage(LANG, 'console.alert_ack')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
