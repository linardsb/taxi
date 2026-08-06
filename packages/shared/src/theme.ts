/**
 * The lean theme seam. Visual identity is deliberately undecided until the
 * brand-identity epic — these are boring neutral placeholders with SEMANTIC
 * names, so the brand lands later by editing values in THIS ONE FILE and
 * nowhere else. Components never hardcode colors/spacing (root CLAUDE.md);
 * RN apps import this object directly, web apps render it via
 * `themeCssVars()` in ./theme-css.
 *
 * Deliberately primitive: no functions, no dark mode, no token pipeline.
 * One brand forever.
 */

export const colors = {
  bg: '#ffffff',
  bgSurface: '#f4f4f5',
  fg: '#18181b',
  fgMuted: '#52525b',
  border: '#d4d4d8',
  accent: '#2563eb',
  accentFg: '#ffffff',
  danger: '#dc2626',
  success: '#16a34a',
  warning: '#d97706',
} as const;

/** 4px scale. Numbers, not strings — RN wants numbers; web adds `px`. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
} as const;

export const fontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
} as const;

export const theme = { colors, spacing, radius, fontSize } as const;

export type Theme = typeof theme;
export type ThemeColor = keyof typeof colors;
export type ThemeSpacing = keyof typeof spacing;
export type ThemeRadius = keyof typeof radius;
export type ThemeFontSize = keyof typeof fontSize;
