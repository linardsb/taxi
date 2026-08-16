'use client';

import { themeCssVars } from '@taxi/shared';
import { RequireRole } from '@/features/auth';

/** The admin route group (#20 fills it) — admin only, same chrome rules. */
export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <style>{themeCssVars()}</style>
      <style>{`
        .console a:focus-visible, .console button:focus-visible,
        .console input:focus-visible {
          outline: 3px solid var(--color-accent);
          outline-offset: 2px;
        }
      `}</style>
      <RequireRole roles={['admin']}>{children}</RequireRole>
    </>
  );
}
