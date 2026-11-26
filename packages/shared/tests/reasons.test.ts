import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '../src/enums';
import { MESSAGES } from '../src/i18n';
import {
  CANCEL_REASONS,
  CANCEL_REASON_CODES,
  DECLINE_REASONS,
  REASON_LABEL_KEYS,
  RIDE_REASON_CODES,
  isCancelReasonFor,
  reasonNeedsText,
} from '../src/reasons';
import { offerDeclineSchema, rideCancelSchema } from '../src/schemas/reasons';

describe('rideCancelSchema', () => {
  it('an empty body parses to null code and text — rider and driver need not explain (expected)', () => {
    expect(rideCancelSchema.parse({})).toEqual({
      reasonCode: null,
      reasonText: null,
    });
  });

  it('a bodiless request (undefined) parses as an empty body (edge, S8)', () => {
    expect(rideCancelSchema.parse(undefined)).toEqual({
      reasonCode: null,
      reasonText: null,
    });
  });

  it('a dispatcher code with a trimmed note passes (expected)', () => {
    expect(
      rideCancelSchema.parse({
        reasonCode: 'dispatcher_rider_request',
        reasonText: '  zvanīja  ',
      }),
    ).toEqual({
      reasonCode: 'dispatcher_rider_request',
      reasonText: 'zvanīja',
    });
  });

  it('an *_other code without text fails on reasonText (edge, D2)', () => {
    const r = rideCancelSchema.safeParse({ reasonCode: 'dispatcher_other' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['reasonText']);
    expect(r.error?.issues[0]?.message).toBe('reason_text_required');
  });

  it('whitespace-only text counts as no text (edge)', () => {
    const r = rideCancelSchema.safeParse({
      reasonCode: 'rider_other',
      reasonText: '   ',
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['reasonText']);
  });

  it('an unknown code is rejected (failure)', () => {
    expect(rideCancelSchema.safeParse({ reasonCode: 'bored' }).success).toBe(
      false,
    );
  });

  it('a decline code is not a cancel code (failure)', () => {
    expect(
      rideCancelSchema.safeParse({ reasonCode: 'decline_too_far' }).success,
    ).toBe(false);
  });

  it('281 characters of text are rejected (failure)', () => {
    expect(
      rideCancelSchema.safeParse({ reasonText: 'a'.repeat(281) }).success,
    ).toBe(false);
    expect(
      rideCancelSchema.safeParse({ reasonText: 'a'.repeat(280) }).success,
    ).toBe(true);
  });
});

describe('offerDeclineSchema', () => {
  it('undefined and {} both parse to nulls (expected)', () => {
    expect(offerDeclineSchema.parse(undefined)).toEqual({
      reasonCode: null,
      reasonText: null,
    });
    expect(offerDeclineSchema.parse({})).toEqual({
      reasonCode: null,
      reasonText: null,
    });
  });

  it('a decline code passes; decline_other needs text (edge)', () => {
    expect(
      offerDeclineSchema.parse({ reasonCode: 'decline_too_far' }).reasonCode,
    ).toBe('decline_too_far');
    expect(
      offerDeclineSchema.safeParse({ reasonCode: 'decline_other' }).success,
    ).toBe(false);
  });

  it('a cancel code is rejected (failure)', () => {
    expect(
      offerDeclineSchema.safeParse({ reasonCode: 'rider_other' }).success,
    ).toBe(false);
  });
});

describe('reason tuples', () => {
  it('CANCEL_REASON_CODES equals the flattened per-actor lists (expected)', () => {
    const flat = Object.values(CANCEL_REASONS).flat();
    expect(new Set(CANCEL_REASON_CODES)).toEqual(new Set(flat));
    expect(CANCEL_REASON_CODES).toHaveLength(flat.length);
  });

  it('RIDE_REASON_CODES is exactly cancel ∪ decline, no duplicates (expected)', () => {
    expect(new Set(RIDE_REASON_CODES)).toEqual(
      new Set([...CANCEL_REASON_CODES, ...DECLINE_REASONS]),
    );
    expect(RIDE_REASON_CODES).toHaveLength(
      CANCEL_REASON_CODES.length + DECLINE_REASONS.length,
    );
  });

  it('every decline code starts with decline_ — the db check relies on it (edge)', () => {
    for (const code of DECLINE_REASONS) expect(code).toMatch(/^decline_/);
    for (const code of CANCEL_REASON_CODES)
      expect(code).not.toMatch(/^decline_/);
  });

  it('isCancelReasonFor keeps actors apart (failure)', () => {
    expect(isCancelReasonFor('rider', 'dispatcher_other')).toBe(false);
    expect(isCancelReasonFor('dispatcher', 'dispatcher_other')).toBe(true);
  });

  it('reasonNeedsText is true only for *_other (edge)', () => {
    expect(reasonNeedsText('decline_other')).toBe(true);
    expect(reasonNeedsText('decline_too_far')).toBe(false);
  });

  it('every code has a label in all three catalogs (expected)', () => {
    for (const code of RIDE_REASON_CODES) {
      const key = REASON_LABEL_KEYS[code];
      for (const lang of LANGUAGES) {
        expect(MESSAGES[lang][key], `${lang}:${code}`).toBeTruthy();
      }
    }
  });
});
