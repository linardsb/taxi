/**
 * Web mapping for the theme seam: renders ./theme as CSS custom properties.
 * dispatch/admin drop the returned `:root` block into a global stylesheet and
 * reference `var(--color-accent)` etc. — so the brand-identity epic still only
 * edits ./theme. RN apps import the TS object directly and never touch this.
 */
import { colors, fontSize, radius, spacing } from './theme';

const kebab = (name: string) =>
  name.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);

export function themeCssVars(): string {
  const lines = [
    ...Object.entries(colors).map(([k, v]) => `  --color-${kebab(k)}: ${v};`),
    ...Object.entries(spacing).map(([k, v]) => `  --spacing-${k}: ${v}px;`),
    ...Object.entries(radius).map(([k, v]) => `  --radius-${k}: ${v}px;`),
    ...Object.entries(fontSize).map(([k, v]) => `  --font-size-${k}: ${v}px;`),
  ];
  return `:root {\n${lines.join('\n')}\n}`;
}
