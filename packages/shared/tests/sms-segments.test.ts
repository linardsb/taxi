import { describe, expect, it } from 'vitest';
import {
  SMS_GSM7_SINGLE_SEGMENT_SEPTETS,
  SMS_UCS2_SINGLE_SEGMENT_CHARS,
  smsSegments,
} from '../src/sms-segments';

// Fixtures are built with `.repeat()`, never pasted — a literal miscounted by
// one asserts the wrong boundary and still passes.
const ascii = (n: number) => 'x'.repeat(n);
const cyrillic = (n: number) => 'я'.repeat(n);

describe('smsSegments', () => {
  it('bills 70 UCS-2 characters as one segment and 71 as two (expected)', () => {
    expect(smsSegments(cyrillic(SMS_UCS2_SINGLE_SEGMENT_CHARS))).toBe(1);
    expect(smsSegments(cyrillic(SMS_UCS2_SINGLE_SEGMENT_CHARS + 1))).toBe(2);
  });

  it('bills 160 GSM-7 septets as one segment and 161 as two (expected)', () => {
    expect(smsSegments(ascii(SMS_GSM7_SINGLE_SEGMENT_SEPTETS))).toBe(1);
    expect(smsSegments(ascii(SMS_GSM7_SINGLE_SEGMENT_SEPTETS + 1))).toBe(2);
  });

  it('charges an extension-table character two septets (edge)', () => {
    // The pair is the assertion: 158 + € = 160 septets (1 segment), 159 + €
    // = 161 (2). If `€` cost one septet, the second case would still be 1.
    expect(smsSegments(`${ascii(158)}€`)).toBe(1);
    expect(smsSegments(`${ascii(159)}€`)).toBe(2);
  });

  it('bills the empty body as one segment (edge)', () => {
    expect(smsSegments('')).toBe(1);
  });

  it('lets one Latvian diacritic flip 200 ASCII characters to UCS-2 (failure)', () => {
    expect(smsSegments(ascii(200))).toBe(2); // derived: ceil(200 / 153)
    // derived: 201 UTF-16 code units, ceil(201 / 67) = 3
    expect(smsSegments(`${ascii(200)}ā`)).toBe(3);
  });

  it('keeps GSM-7 for the non-ASCII characters the table does contain (edge)', () => {
    // The assertion a naive /^[\x00-\x7F]*$/ encoding test fails: `ä` is
    // GSM-7 (0x7B) and the backtick, which IS ASCII, is not in the table.
    expect(smsSegments(`${ascii(159)}ä`)).toBe(1); // derived: 160 septets
    // The mirror: 101 characters is one GSM-7 segment, but the backtick is
    // not in the table, so this is UCS-2 — ceil(101 / 67) = 2.
    expect(smsSegments(`${ascii(100)}\``)).toBe(2);
  });
});
