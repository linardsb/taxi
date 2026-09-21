/**
 * Billed-SMS-segment arithmetic (3GPP TS 23.038 §6.2.1, §6.2.3) — the first
 * thing in the tree that can count what an SMS actually costs.
 *
 * WHY IT SHIPS rather than living in a test helper: the send path asserts on
 * it at runtime (`ride.notifications.sms_multi_segment`), and the budget proof
 * in `tests/sms-budget.test.ts` asserts through it. One implementation, two
 * readers, so a fix reaches both.
 *
 * The encoding is a property of the WHOLE body, not of a character: one
 * character outside GSM-7 flips the entire message to UCS-2 and the limit
 * drops from 160 septets to 70 code units. That is why the LV and RU catalogs
 * are UCS-2 by construction — their fixed text carries diacritics and
 * Cyrillic, so no rider input can make them cheaper or dearer per character.
 *
 * NOT MODELLED, and there are TWO of these, one per encoding:
 *
 * - UCS-2: a surrogate pair straddling a concatenated-segment boundary. The
 *   standard handles it by shortening that segment; this counts UTF-16 code
 *   units flat. No catalog string contains a non-BMP character.
 * - GSM-7: the same rule for an escaped character. ESC + char is two septets
 *   and §6.2.1.1 forbids splitting them, so the segment before the break holds
 *   152 septets rather than 153 and the pair moves whole into the next one.
 *   This counts septets flat.
 *
 * Both are exact for the single-segment case that bills here, and off by at
 * most one segment on a multi-segment body. The GSM-7 one is the likelier to
 * bite if the bounds ever move, because `~` — an extension-table character,
 * hence two septets — is in all three `driver_assigned` templates, where a
 * non-BMP name is hypothetical.
 *
 * Neither is reachable today, because nothing here reaches a CONCATENATED
 * GSM-7 body in the first place. EN is the only GSM-7 template that carries a
 * link, and `observed` with every term at its bound it renders 69 septets at
 * the enforced production host and 73 at the 14-character dev default —
 * against the 160-septet single-segment limit either way.
 */

/**
 * The GSM-7 default alphabet (§6.2.1), minus 0x1B ESC — ESC is the escape to
 * the extension table below, never a character in its own right.
 *
 * Written out rather than range-tested because the set is NOT ASCII in either
 * direction: `£ ¥ è é ù ì ò Ç Ø ø Å å Δ Φ Γ Λ Ω Π Ψ Σ Θ Ξ Æ æ ß É Ä Ö Ñ Ü § ¿
 * ä ö ñ ü à` are single septets despite being non-ASCII, while the backtick
 * (U+0060) is ASCII and is NOT in the table at all. Latvian `ā č ē ģ ī ķ ļ ņ
 * š ū ž` are correctly absent, which is what makes the LV catalog UCS-2.
 */
const GSM7_BASIC_CHARS =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ' +
  ' !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§' +
  '¿abcdefghijklmnopqrstuvwxyzäöñüà';

/**
 * The GSM-7 extension table (§6.2.1.1). Each of these is sent as ESC + the
 * character and therefore costs **two** septets. `~` is the one that matters
 * here: it is in every `driver_assigned` template.
 */
const GSM7_EXTENSION_CHARS = '\f^{}\\[~]|€';

const GSM7_BASIC = new Set([...GSM7_BASIC_CHARS]);
const GSM7_EXTENSION = new Set([...GSM7_EXTENSION_CHARS]);

/** 140 octets / 7 bits — the limit for a body sent as one GSM-7 segment. */
export const SMS_GSM7_SINGLE_SEGMENT_SEPTETS = 160;

/** 140 octets / 2 — the limit for a body sent as one UCS-2 segment. */
export const SMS_UCS2_SINGLE_SEGMENT_CHARS = 70;

/** Concatenation spends 6 octets of each segment on the UDH (7 septets). */
export const SMS_GSM7_CONCATENATED_SEGMENT_SEPTETS = 153;

/** Same UDH, 3 UTF-16 code units' worth. */
export const SMS_UCS2_CONCATENATED_SEGMENT_CHARS = 67;

/**
 * How many segments a carrier bills for `body`.
 *
 * Returns 1 for the empty string: a zero-length body is still one message, and
 * no send path in the tree produces one anyway.
 */
export function smsSegments(body: string): number {
  let septets = 0;

  for (const char of body) {
    if (GSM7_BASIC.has(char)) {
      septets += 1;
    } else if (GSM7_EXTENSION.has(char)) {
      septets += 2;
    } else {
      // One non-GSM-7 character re-encodes the WHOLE body, so the septets
      // counted so far are void and the unit becomes UTF-16 code units.
      return body.length <= SMS_UCS2_SINGLE_SEGMENT_CHARS
        ? 1
        : Math.ceil(body.length / SMS_UCS2_CONCATENATED_SEGMENT_CHARS);
    }
  }

  return septets <= SMS_GSM7_SINGLE_SEGMENT_SEPTETS
    ? 1
    : Math.ceil(septets / SMS_GSM7_CONCATENATED_SEGMENT_SEPTETS);
}
