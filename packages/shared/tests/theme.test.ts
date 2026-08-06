import { describe, expect, it } from 'vitest';
import { colors } from '../src/theme';
import { themeCssVars } from '../src/theme-css';

// Hand-written WCAG 2.x relative-luminance / contrast math (no dependency),
// per https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio.
function linearize(hex: string, offset: number): number {
  const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  return (
    0.2126 * linearize(hex, 1) +
    0.7152 * linearize(hex, 3) +
    0.0722 * linearize(hex, 5)
  );
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const AA_NORMAL_TEXT = 4.5;

describe('theme contrast', () => {
  it('sanity-checks the hand-rolled math at the extremes (edge)', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('meaningful fg/bg pairs meet WCAG AA for normal text (expected)', () => {
    expect(contrastRatio(colors.fg, colors.bg)).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT,
    );
    expect(contrastRatio(colors.fgMuted, colors.bg)).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT,
    );
    expect(
      contrastRatio(colors.accentFg, colors.accent),
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(colors.danger, colors.bg)).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT,
    );
  });

  it('the math actually fails an inaccessible pair (failure)', () => {
    // bgSurface-on-bg is a surface distinction, never a text pair — it must
    // NOT pass, or the assertion above would be vacuous.
    expect(contrastRatio(colors.bgSurface, colors.bg)).toBeLessThan(
      AA_NORMAL_TEXT,
    );
  });
});

describe('themeCssVars', () => {
  it('renders every theme group as :root custom properties (expected)', () => {
    const css = themeCssVars();
    expect(css.startsWith(':root {')).toBe(true);
    expect(css.endsWith('}')).toBe(true);
    expect(css).toContain(`  --color-bg-surface: ${colors.bgSurface};`);
    expect(css).toContain('  --spacing-xs: 4px;');
    expect(css).toContain('  --radius-md: 8px;');
    expect(css).toContain('  --font-size-xl: 24px;');
  });
});
