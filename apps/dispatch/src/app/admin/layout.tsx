'use client';

import { themeCssVars } from '@taxi/shared';
import { AdminNav } from '@/features/admin-shell';
import { RequireRole } from '@/features/auth';

/**
 * The admin route group (#20) — admin only, same chrome rules as /dispatch.
 * The nav sits INSIDE the gate, so a non-admin never sees it, and the one
 * `<main>` lives here: pages render into it and never add their own.
 */
export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <style>{themeCssVars()}</style>
      {/* Visible focus on every interactive element — the admin forms add
          `select` (vehicle category) and `textarea` to the console's set, and
          the headings focus moves to (h1, the detail's approval h2). */}
      <style>{`
        .console a:focus-visible, .console button:focus-visible,
        .console input:focus-visible, .console select:focus-visible,
        .console textarea:focus-visible, .console h1:focus-visible,
        .console h2:focus-visible {
          outline: 3px solid var(--color-accent);
          outline-offset: 2px;
        }
      `}</style>
      <RequireRole roles={['admin']}>
        <main
          className="console"
          style={{
            minHeight: '100dvh',
            display: 'grid',
            alignContent: 'start',
            gap: 'var(--spacing-lg)',
            padding: 'var(--spacing-lg)',
            background: 'var(--color-bg)',
            color: 'var(--color-fg)',
          }}
        >
          <AdminNav />
          {children}
        </main>
      </RequireRole>
    </>
  );
}
