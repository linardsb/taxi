'use client';

import { themeCssVars } from '@taxi/shared';
import { RequireRole } from '@/features/auth';

/**
 * The dispatcher route group: role gate + theme + focus-visible CSS. The
 * board page owns its own header (pill, view toggle) because that chrome is
 * board STATE — see use-board. Client layout: the gate reads localStorage.
 *
 * The client gate is UX; the API's `@Roles('dispatcher','admin')` on every
 * read this group makes is the enforcement (apps/dispatch/CLAUDE.md).
 */
export default function DispatchLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <style>{themeCssVars()}</style>
      {/* Visible focus on every interactive element — a hard launch rule. */}
      <style>{`
        .console a:focus-visible, .console button:focus-visible,
        .console input:focus-visible {
          outline: 3px solid var(--color-accent);
          outline-offset: 2px;
        }
      `}</style>
      <RequireRole roles={['dispatcher', 'admin']}>{children}</RequireRole>
    </>
  );
}
