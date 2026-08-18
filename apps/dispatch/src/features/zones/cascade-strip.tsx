'use client';

import {
  formatMessage,
  isMessageKey,
  type DispatchBoardEvent,
  type Language,
} from '@taxi/shared';

const LANG: Language = 'lv';

type Cascade = NonNullable<DispatchBoardEvent['rides'][number]['cascade']>;

/**
 * Seconds left on the offer, re-derived from the board's own `nowMs` — which
 * already ticks at 1 Hz in `use-board`. No second timer: two clocks on one
 * screen drift, and the one that is wrong is the one Dina is reading.
 *
 * A lapsed offer reads 0, never a negative number. The frame is ≤2 s behind
 * the deadline it carries, so «-3» is a normal moment in the cascade rather
 * than an error — and a countdown that goes negative reads as a bug in the
 * board, which costs trust in every other number on it.
 */
function secondsLeft(nowMs: number, expiresAt: string | null): number | null {
  if (expiresAt === null) return null;
  const deadline = Date.parse(expiresAt);
  if (Number.isNaN(deadline)) return null;
  return Math.max(0, Math.ceil((deadline - nowMs) / 1000));
}

function Part({
  children,
  muted,
}: Readonly<{ children: React.ReactNode; muted?: boolean }>) {
  return (
    <span style={muted ? { color: 'var(--color-fg-muted)' } : undefined}>
      {children}
    </span>
  );
}

/**
 * The cascade line under an offered ride: who holds it, how long they have,
 * who is next, and one line of why (evidence F3.3 — dispatchers override
 * confidently only when they can see the logic).
 *
 * STATUS, NOT AN ALARM (ISA-18.2, evidence F4.1). It recolors in place and
 * never flashes, toasts or beeps: only `dispatch:unclaimed`,
 * `dispatch:sms_failed` and the socket going offline may alarm, and a
 * countdown that competed with them would spend the alarm budget on the
 * ordinary case.
 *
 * The explanation is rendered from the key the SERVER composed — never
 * recomposed here — so the sentence on this strip is the one the driver is
 * reading on their offer card.
 */
export function CascadeStrip({
  cascade,
  nowMs,
}: Readonly<{ cascade: Cascade; nowMs: number }>) {
  const remaining = secondsLeft(nowMs, cascade.expiresAt);

  return (
    <span
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        gap: 'var(--spacing-sm)',
        fontSize: 'var(--font-size-sm)',
      }}
    >
      {cascade.offeredToName === null ? (
        <Part muted>{formatMessage(LANG, 'console.cascade_unheld')}</Part>
      ) : (
        <Part>
          {formatMessage(LANG, 'console.cascade_offered_to', {
            driver: cascade.offeredToName,
          })}
        </Part>
      )}

      {remaining !== null && (
        // Digits only, like `ride-queue.tsx:ageOf` — nothing to translate, and
        // seconds are the unit Dina counts an offer in.
        <span
          style={{
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 700,
            color:
              remaining === 0 ? 'var(--color-warning)' : 'var(--color-accent)',
          }}
        >
          {remaining}
        </span>
      )}

      {cascade.nextDriverName !== null && (
        <Part muted>
          {formatMessage(LANG, 'console.cascade_next', {
            driver: cascade.nextDriverName,
          })}
        </Part>
      )}

      {cascade.attempts > 0 && (
        <Part muted>
          {formatMessage(LANG, 'console.cascade_attempts', {
            count: cascade.attempts,
          })}
        </Part>
      )}

      {/* The key comes off the WIRE, so it is checked rather than cast: an api
          one deploy ahead of this bundle drops the sentence, it does not throw
          inside `formatMessage` and take the whole ride queue down. */}
      {cascade.explanation !== null && isMessageKey(cascade.explanation.key) && (
        <Part muted>
          {formatMessage(
            LANG,
            cascade.explanation.key,
            cascade.explanation.params,
          )}
        </Part>
      )}
    </span>
  );
}
