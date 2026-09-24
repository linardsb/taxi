import type { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { LANGUAGES, type Language } from '../src/enums';
import { formatMessage } from '../src/format-message';
import { vehicleSchema } from '../src/schemas/vehicle';
import { smsSegments } from '../src/sms-segments';
import {
  SMS_DRIVER_NAME_MAX_CHARS,
  SMS_ETA_MAX_DISPLAY_MINUTES,
  TRACKING_LINK_HOST_MAX_CHARS,
  trackingLink,
} from '../src/tracking-link';

/**
 * THE #136 BUDGET PROOF: both linked rider SMS render one billed segment in
 * all three languages, at the maximum of every bound.
 *
 * WHY ONE CASE PER ROW IS A PROOF AND NOT A SAMPLE. The rendered length is
 * strictly additive — `fixed + |driver| + |plate| + |eta| + |link|` — and
 * monotone in each term, and every term is bounded (see `tracking-link.ts`'s
 * header for the four bounds and where each is enforced). Maximising each
 * term independently therefore maximises the total, so a body longer than the
 * one asserted below cannot exist. There is no input outside these rows.
 *
 * WHY THE LENGTH ASSERTION AND NOT JUST THE SEGMENT COUNT.
 * `TRACKING_LINK_HOST_MAX_CHARS` is itself derived from the RU row, which has
 * zero spare. A character added to the RU fixed text reddens the segment
 * assertion, and the tempting fix is to widen the constant — which moves the
 * guarantee with nothing objecting. Pinning the exact length makes the
 * derivation executable rather than commentary: widening the host budget
 * fails these assertions even while every body still fits one segment.
 */

/**
 * DERIVED, not copied. This was `const PLATE_MAX_CHARS = 10` with a line
 * reference to `schemas/vehicle.ts` — the one bound of the four this file did
 * not read from its source, and therefore the one place the file's own thesis
 * (above) did not hold. `reproduced` in PR #245's review: widening
 * `vehicleSchema.plate` to `.max(12)` left all 251 shared tests green while the
 * binding RU row went 70 → 72 characters and 1 → 2 billed segments. `.max(12)`
 * is not a contrived mutation — LV plates are 7, and the first foreign plate
 * registered is the obvious occasion.
 *
 * `.maxLength` is `number | null` in zod 3, so REMOVING `.max()` — the other
 * way to unbind this term — must redden here too rather than silently render
 * `NaN` characters of plate. Hence the throw: it fires at module load and
 * takes the whole file with it, which is the loudest available failure.
 */
function boundOf(schema: z.ZodString, name: string): number {
  const max = schema.maxLength;
  if (max === null) {
    throw new Error(
      `${name} has no .max(): the #136 SMS budget just lost its plate bound, ` +
        `so the one-segment property is no longer a proof over all inputs.`,
    );
  }
  return max;
}

const PLATE_MAX_CHARS = boundOf(
  vehicleSchema.shape.plate,
  'vehicleSchema.plate',
);

/**
 * NOT `'sakta.lv'` (8). The test asserts the budget the production boot gate
 * ENFORCES; the real domain would pass with two characters of slack the gate
 * does not require, and the test would stop being the guard.
 */
const HOST_AT_CEILING = 'x'.repeat(TRACKING_LINK_HOST_MAX_CHARS);

const TOKEN = 't'.repeat(16); // randomBytes(12).toString('base64url')

/** The two templates that carry a tracking link — the only two in budget. */
const LINKED_KEYS = [
  'sms.driver_assigned',
  'sms.booking_confirmed_phone',
] as const;
type LinkedKey = (typeof LINKED_KEYS)[number];

/** Exact rendered lengths at every bound — the budget table, executable. */
const EXPECTED_LENGTH: Record<Language, Record<LinkedKey, number>> = {
  //        fixed + name + plate + eta + link(10+1+1+1+16 = 29)
  lv: { 'sms.driver_assigned': 69, 'sms.booking_confirmed_phone': 59 },
  ru: { 'sms.driver_assigned': 70, 'sms.booking_confirmed_phone': 55 },
  en: { 'sms.driver_assigned': 68, 'sms.booking_confirmed_phone': 50 },
};

function renderAtBounds(
  language: Language,
  key: LinkedKey,
  host: string = HOST_AT_CEILING,
): string {
  const link = trackingLink(`https://${host}`, TOKEN, language);
  return key === 'sms.driver_assigned'
    ? formatMessage(language, key, {
        driver: 'A'.repeat(SMS_DRIVER_NAME_MAX_CHARS),
        plate: 'A'.repeat(PLATE_MAX_CHARS),
        eta: SMS_ETA_MAX_DISPLAY_MINUTES,
        link,
      })
    : formatMessage(language, key, { link });
}

describe('the linked rider SMS at the maximum of every bound', () => {
  for (const language of LANGUAGES) {
    for (const key of LINKED_KEYS) {
      it(`bills ${language} ${key} as one segment (expected)`, () => {
        const body = renderAtBounds(language, key);
        expect(body, body).not.toContain('{');
        expect(body).toHaveLength(EXPECTED_LENGTH[language][key]);
        expect(smsSegments(body), body).toBe(1);
      });
    }
  }

  it('leaves the binding RU row with zero spare, by construction (edge)', () => {
    // The host ceiling was solved FOR this row. If this ever has spare, the
    // ceiling is leaving characters on the table; if it is over, the ceiling
    // is wrong. Either way the derivation, not the copy, is what changed.
    const body = renderAtBounds('ru', 'sms.driver_assigned');
    expect(body).toHaveLength(70);
  });

  it('bills a SECOND segment one character over the ceiling (failure)', () => {
    // THE FILE'S ONLY NEGATIVE, and what makes the seven assertions above a
    // guard rather than seven facts. Everything else here asserts that a
    // budgeted body fits; none of it demonstrates that an over-budget one does
    // NOT — so a ceiling quietly widened to accommodate a longer domain would
    // move every expectation in step and still read green.
    //
    // One character over is the whole margin: the RU row has zero spare at the
    // ceiling by construction (the case above), so `TRACKING_LINK_HOST_MAX_CHARS
    // + 1` is exactly the boundary the production boot gate refuses, and 71 > 70
    // is what the refusal buys. This is `saktacab.lv` (11) — the real rejected
    // domain, not a synthetic one.
    const overCeiling = 'x'.repeat(TRACKING_LINK_HOST_MAX_CHARS + 1);
    const body = renderAtBounds('ru', 'sms.driver_assigned', overCeiling);

    expect(body).toHaveLength(71);
    expect(smsSegments(body), body).toBe(2);
  });
});

/**
 * #258: the phone rider's arrival SMS with the pickup PIN. Same additive
 * argument as above, with two terms: `fixed + |plate| + |pin|`, the PIN a
 * fixed 4 digits. Fixed parts (placeholders removed): lv 33, ru 29, en 31, so
 * `derived` lv 33+10+4 = 47, ru 29+10+4 = 43, en 31+10+4 = 45 — well inside
 * one segment (70 UCS-2 for lv/ru, 160 GSM-7 for en).
 */
const PIN_ARRIVAL_LENGTH: Record<Language, number> = { lv: 47, ru: 43, en: 45 };

describe('the PIN arrival SMS at the maximum of every bound', () => {
  for (const language of LANGUAGES) {
    it(`bills ${language} sms.driver_arrived_pin as one segment (expected)`, () => {
      const body = formatMessage(language, 'sms.driver_arrived_pin', {
        plate: 'A'.repeat(PLATE_MAX_CHARS),
        pin: '0000',
      });
      expect(body, body).not.toContain('{');
      expect(body).toHaveLength(PIN_ARRIVAL_LENGTH[language]);
      expect(smsSegments(body), body).toBe(1);
    });
  }
});
