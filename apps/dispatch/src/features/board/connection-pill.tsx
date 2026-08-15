'use client';

import { formatMessage, type Language } from '@taxi/shared';
import type { PillState } from './board-state';

const LANG: Language = 'lv';

const PILL_COLOR: Record<PillState, string> = {
  live: 'var(--color-success)',
  reconnecting: 'var(--color-warning)',
  offline: 'var(--color-danger)',
};

const PILL_KEY = {
  live: 'console.live',
  reconnecting: 'console.reconnecting',
  offline: 'console.offline',
} as const;

/**
 * The truthful connection pill — its text comes ONLY from the pillFrom
 * derivation upstream (frame receipt, not socket flags). `aria-live="polite"`:
 * a state change is worth announcing, the 1 Hz staleness re-derivation that
 * usually confirms the same state is not (text only changes on a real flip).
 */
export function ConnectionPill({ pill }: Readonly<{ pill: PillState }>) {
  return (
    <span
      aria-live="polite"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--spacing-xs)',
        padding: 'var(--spacing-xs) var(--spacing-md)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-bg-surface)',
        border: `2px solid ${PILL_COLOR[pill]}`,
        color: 'var(--color-fg)',
        fontSize: 'var(--font-size-sm)',
        fontWeight: 600,
        minHeight: 32,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: PILL_COLOR[pill],
        }}
      />
      {formatMessage(LANG, PILL_KEY[pill])}
    </span>
  );
}
