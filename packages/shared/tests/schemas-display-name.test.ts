import { describe, expect, it } from 'vitest';
import { callerLookupSchema } from '../src/schemas/customer';
import {
  DISPLAY_NAME_MAX,
  displayNameSchema,
  readDisplayName,
  riderDisplayNameUpdateSchema,
} from '../src/schemas/user';

describe('displayNameSchema (#269)', () => {
  it('trims a written name (expected)', () => {
    expect(displayNameSchema.parse('  Anna Bērziņa ')).toBe('Anna Bērziņa');
  });

  it('accepts exactly DISPLAY_NAME_MAX units and refuses one more (edge)', () => {
    expect(
      displayNameSchema.safeParse('ā'.repeat(DISPLAY_NAME_MAX)).success,
    ).toBe(true);
    expect(
      displayNameSchema.safeParse('ā'.repeat(DISPLAY_NAME_MAX + 1)).success,
    ).toBe(false);
  });

  it.each(['   ', '', 'An\u0000na', 'An\nna'])(
    'refuses %j (failure)',
    (raw) => {
      expect(displayNameSchema.safeParse(raw).success).toBe(false);
    },
  );
});

describe('riderDisplayNameUpdateSchema (#269)', () => {
  it('accepts null, which removes the name (expected)', () => {
    expect(riderDisplayNameUpdateSchema.parse({ displayName: null })).toEqual({
      displayName: null,
    });
  });

  it('refuses a blank name rather than storing it (failure)', () => {
    expect(
      riderDisplayNameUpdateSchema.safeParse({ displayName: '  ' }).success,
    ).toBe(false);
  });
});

describe('readDisplayName (#269)', () => {
  it('trims a stored name (expected)', () => {
    expect(readDisplayName(' Anna ')).toBe('Anna');
  });

  it('reads blank and missing as null, and cuts an over-long row (edge)', () => {
    expect(readDisplayName('   ')).toBeNull();
    expect(readDisplayName(undefined)).toBeNull();
    expect(readDisplayName(null)).toBeNull();
    expect(readDisplayName('x'.repeat(130))).toHaveLength(DISPLAY_NAME_MAX);
  });
});

describe('callerLookupSchema.displayName (#269)', () => {
  it('defaults to null, so a new console still parses an old api (edge)', () => {
    const parsed = callerLookupSchema.parse({
      userId: '00000000-0000-4000-8000-000000000001',
      customer: null,
    });
    expect(parsed.displayName).toBeNull();
  });
});
