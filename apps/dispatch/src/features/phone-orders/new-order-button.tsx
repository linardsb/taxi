'use client';

import { formatMessage, type Language } from '@taxi/shared';
import { useEffect } from 'react';

const LANG: Language = 'lv';

/**
 * ⌥N opens the booking form from anywhere on the board.
 *
 * `event.altKey` with `event.code`, not `event.key`: Alt+N on macOS produces
 * the character "˜", so a `key === 'n'` check never fires there. `code` is the
 * physical key and is layout-independent, which also makes this work on the
 * Latvian layout Dina actually types on.
 *
 * Ignored while focus is in a text field — a dispatcher typing a note must be
 * able to type, and a global hotkey that steals keystrokes from an input is
 * worse than no hotkey.
 */
export function useNewOrderHotkey(onOpen: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.code !== 'KeyN') return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      onOpen();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onOpen]);
}

/** The same action as the hotkey, for the hand that reached for the mouse. */
export function NewOrderButton({ onOpen }: Readonly<{ onOpen: () => void }>) {
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        minHeight: 44,
        padding: 'var(--spacing-xs) var(--spacing-md)',
        borderRadius: 'var(--radius-md)',
        border: 'none',
        background: 'var(--color-accent)',
        color: 'var(--color-accent-fg)',
        fontSize: 'var(--font-size-sm)',
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {formatMessage(LANG, 'console.new_order_hotkey')}
    </button>
  );
}
