import { themeCssVars } from '@taxi/shared';

/**
 * Login segment — theme + focus-visible, same shape as the tracking and
 * dispatch segment layouts (each segment injects its own on purpose; the
 * brand epic still edits only the one theme file).
 */
export default function LoginLayout({
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
      {children}
    </>
  );
}
