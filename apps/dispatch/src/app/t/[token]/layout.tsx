import { themeCssVars } from '@taxi/shared';

/**
 * Public tracking segment (#63) — no auth, no console chrome. The theme
 * arrives as CSS custom properties from the ONE shared theme file
 * (`themeCssVars()`), so the brand-identity epic restyles this page without
 * touching it; everything below references `var(--color-*)` etc. only.
 */
export default function TrackingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <style>{themeCssVars()}</style>
      {/* Visible focus on every interactive element — a hard launch rule. */}
      <style>{`
        .tracking a:focus-visible, .tracking button:focus-visible {
          outline: 3px solid var(--color-accent);
          outline-offset: 2px;
        }
      `}</style>
      {children}
    </>
  );
}
