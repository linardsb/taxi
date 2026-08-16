'use client';

import {
  formatMessage,
  type Language,
  type MessageKey,
  type SmsKind,
} from '@taxi/shared';
import { useEffect, useRef, useState } from 'react';
import type { BoardAlert } from './board-state';

const LANG: Language = 'lv';

/** Total over `SmsKind` — a new kind in the shared tuple fails the build here. */
const SMS_KIND_KEY: Record<SmsKind, MessageKey> = {
  booking_confirmed: 'console.sms_kind_booking_confirmed',
  driver_assigned: 'console.sms_kind_driver_assigned',
  driver_arrived: 'console.sms_kind_driver_arrived',
};

function alertText(alert: BoardAlert): string {
  switch (alert.kind) {
    case 'unclaimed':
      return `${formatMessage(LANG, 'console.alert_unclaimed')} — ${alert.address}`;
    case 'sms_failed':
      // No `?? 'console.alert_sms_failed'` fallback: it was unreachable, and
      // had it ever fired it would have nested the template into its own
      // {kind} slot — «Neizdevās nosūtīt Neizdevās nosūtīt {kind}».
      return formatMessage(LANG, 'console.alert_sms_failed', {
        kind: formatMessage(LANG, SMS_KIND_KEY[alert.smsKind]),
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
  /**
   * Ids already announced. A single "last seen newest id" cannot express this:
   * acknowledging the top alert makes `alerts[0]` the one UNDERNEATH, whose id
   * differs from the last seen one and so reads as new — clearing N alerts
   * beeps N−1 times for alarms already on screen and already seen. That is the
   * opposite of the ISA-18.2 discipline this panel exists to keep.
   */
  const beepedIds = useRef<Set<string>>(new Set());

  // Beep once per NEW newest-alert, never on re-render or acknowledge.
  useEffect(() => {
    const present = new Set(alerts.map((a) => a.id));
    // Prune departed ids so the ledger stays bounded by ALERTS_CAP. An alert
    // that is acked and later re-raised legitimately beeps again.
    for (const id of beepedIds.current) {
      if (!present.has(id)) beepedIds.current.delete(id);
    }

    const newestId = alerts[0]?.id;
    const isNew = newestId !== undefined && !beepedIds.current.has(newestId);
    // EVERY alert on screen counts as announced, not just the newest — an
    // alert that reaches the top later because the one above it was acked has
    // been sitting in front of Dina the whole time and is not a new alarm.
    for (const id of present) beepedIds.current.add(id);

    if (isNew && !muted && audioCtx.current) beep(audioCtx.current);
  }, [alerts, muted]);

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
        /**
         * ONE live region wrapping the list, not one per row. `role="alert"`
         * on each `<li>` overrode its implicit `listitem` role — leaving a
         * `<ul>` with no list children, so a screen reader announced neither
         * "list of N" nor "item 2 of 3" — and made every row its own
         * assertive region. `aria-atomic="false"` so an arriving alert
         * announces itself rather than re-reading the whole list.
         */
        <div role="alert" aria-atomic="false">
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
        </div>
      )}
    </section>
  );
}
