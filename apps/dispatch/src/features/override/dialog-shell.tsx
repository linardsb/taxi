'use client';

import { useEffect, useRef } from 'react';

/**
 * The modal shell both override dialogs sit in: labelled, Escape-closable, and
 * focus-trapped.
 *
 * The trap is the part that matters on this screen. A dispatcher is on a call
 * with one hand on the keyboard; tabbing out of an open dialog into the board
 * behind it means typing into nothing. It is also why Escape ALWAYS closes —
 * a dispatcher must never be stuck in a dialog she opened by accident, and the
 * board behind it is the thing she is being paid to watch.
 */
export function DialogShell({
  title,
  onClose,
  children,
}: Readonly<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}>) {
  const ref = useRef<HTMLDivElement>(null);

  // Focus the first control on open. Without this the dialog opens with focus
  // still on the board button behind it, and the first Tab goes backwards.
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>(
      'input, button, textarea, [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    // Hand-rolled rather than `inert`/`<dialog>`: jsdom implements neither
    // usefully, and a trap that cannot be tested is a trap that silently
    // breaks. The query re-runs per keypress because the picker's list — and
    // so the tabbable set — changes as Dina filters.
    const focusable = [
      ...(ref.current?.querySelectorAll<HTMLElement>(
        'input:not([disabled]), button:not([disabled]), textarea:not([disabled])',
      ) ?? []),
    ];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <div
      // The backdrop. A click on it closes — the same escape hatch as Escape,
      // for the hand that reached for the mouse anyway.
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--spacing-md)',
        zIndex: 10,
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={onKeyDown}
        onClick={(event) => event.stopPropagation()}
        style={{
          display: 'grid',
          gap: 'var(--spacing-md)',
          width: 'min(560px, 100%)',
          maxHeight: '85dvh',
          overflowY: 'auto',
          padding: 'var(--spacing-lg)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-bg-surface)',
          color: 'var(--color-fg)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** The one button shape both dialogs use — 44px minimum, per the launch rule. */
export function dialogButtonStyle(
  variant: 'primary' | 'secondary' | 'danger',
): React.CSSProperties {
  const background = {
    primary: 'var(--color-accent)',
    secondary: 'var(--color-bg-surface)',
    danger: 'var(--color-danger)',
  }[variant];
  return {
    minHeight: 44,
    padding: 'var(--spacing-xs) var(--spacing-md)',
    borderRadius: 'var(--radius-md)',
    border:
      variant === 'secondary' ? '1px solid var(--color-border)' : 'none',
    background,
    color:
      variant === 'secondary' ? 'var(--color-fg)' : 'var(--color-accent-fg)',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 600,
    cursor: 'pointer',
  };
}
