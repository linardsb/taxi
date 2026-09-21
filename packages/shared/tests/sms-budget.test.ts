import { describe, expect, it } from 'vitest';
import { LANGUAGES, type Language } from '../src/enums';
import { formatMessage } from '../src/format-message';
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

/** `src/schemas/vehicle.ts:7` — `plate: z.string().min(2).max(10)`. */
const PLATE_MAX_CHARS = 10;

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

function renderAtBounds(language: Language, key: LinkedKey): string {
  const link = trackingLink(`https://${HOST_AT_CEILING}`, TOKEN, language);
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
});
